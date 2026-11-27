use crate::{
    Context, Error, Result, help,
    protocol::{Inbound, parse_request, read_request, reply},
    store::{Start, Store, wall_ms},
};
use rustix::event::{PollFd, PollFlags, Timespec, poll};
use std::{
    fs::{self, DirBuilder, File, OpenOptions},
    io,
    os::unix::{
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

pub(crate) fn validate_directory(path: &Path) -> Result<()> {
    let stat = fs::symlink_metadata(path).context("inspect private directory")?;
    let uid = rustix::process::geteuid();
    if uid.is_root() || !stat.is_dir() || stat.mode() & 0o777 != 0o700 || stat.uid() != uid.as_raw()
    {
        return Err(Error::Boundary(
            "use an unprivileged account and owned 0700 directories",
        ));
    }
    Ok(())
}

fn prepare_directory(path: &Path) -> Result<()> {
    if rustix::process::geteuid().is_root() {
        return Err(Error::Boundary("do not run the laboratory as root"));
    }
    match fs::symlink_metadata(path) {
        Ok(_) => (),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            DirBuilder::new()
                .mode(0o700)
                .create(path)
                .context("create private directory")?;
        }
        Err(error) => return Err(Error::Io("inspect private directory", error)),
    }
    validate_directory(path)
}

fn lock(path: &Path) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)
        .context("open local lock")?;
    file.try_lock()
        .map_err(|_| Error::Boundary("another daemon owns this state or runtime directory"))?;
    Ok(file)
}

const JOURNAL_INTERVAL: Duration = Duration::from_millis(15);

fn wait_for_owner(listener: &UnixListener, last_tick: Instant) -> Result<()> {
    let duration = JOURNAL_INTERVAL.saturating_sub(last_tick.elapsed());
    let nanos = i64::try_from(duration.as_nanos()).map_err(|_| Error::Clock)?;
    let timeout = Timespec {
        tv_sec: 0,
        tv_nsec: nanos,
    };
    let mut fds = [PollFd::new(listener, PollFlags::IN)];
    match poll(&mut fds, Some(&timeout)) {
        Ok(_) | Err(rustix::io::Errno::INTR) => Ok(()),
        Err(error) => Err(Error::Io("wait for owner socket", error.into())),
    }
}

struct OwnedSocket(PathBuf);
impl Drop for OwnedSocket {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn handle(stream: &mut UnixStream, store: &mut Store) -> Result<()> {
    // Bad, slow or disconnected owner peers do not take down the journal.
    let Ok(bytes) = read_request(stream) else {
        return Ok(());
    };
    let (status, body) = match parse_request(&bytes) {
        Inbound::Health => ("200 OK", r#"{"status":"ready","protocol":1}"#),
        Inbound::Start(id) => match store.start(&id, wall_ms()?)? {
            Start::Started => ("200 OK", r#"{"status":"started"}"#),
            Start::Existing => ("200 OK", r#"{"status":"existing"}"#),
            Start::Capacity => ("409 Conflict", r#"{"status":"capacity"}"#),
        },
        Inbound::NotFound => ("404 Not Found", r#"{"error":"not-found"}"#),
        Inbound::Invalid => ("400 Bad Request", r#"{"error":"unexpected-request"}"#),
    };
    // A committed action may outlive the response. Retrying is idempotent.
    let _ = reply(stream, status, body);
    Ok(())
}

pub fn serve(state: &Path, runtime: &Path) -> Result<()> {
    prepare_directory(state)?;
    prepare_directory(runtime)?;
    let _state_lock = lock(&state.join("state.lock"))?;
    let _runtime_lock = lock(&runtime.join("runtime.lock"))?;
    let mut store = Store::open(&state.join("rust-host.sqlite"))?;

    let stop = Arc::new(AtomicBool::new(false));
    signal_hook::flag::register(signal_hook::consts::SIGTERM, Arc::clone(&stop))
        .context("register SIGTERM")?;
    signal_hook::flag::register(signal_hook::consts::SIGINT, Arc::clone(&stop))
        .context("register SIGINT")?;
    let path = runtime.join("owner.sock");
    let listener = UnixListener::bind(&path)
        .context("bind owner socket; use a fresh runtime directory after a crash")?;
    let _socket = OwnedSocket(path);
    fs::set_permissions(&_socket.0, fs::Permissions::from_mode(0o600))
        .context("protect owner socket")?;
    listener
        .set_nonblocking(true)
        .context("set owner listener to nonblocking")?;
    help(r#"{"status":"ready","protocol":1}"#)?;

    let mut last_tick = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        if last_tick.elapsed() >= JOURNAL_INTERVAL {
            store.tick(wall_ms()?)?;
            last_tick = Instant::now();
        }
        match listener.accept() {
            Ok((mut stream, _)) => handle(&mut stream, &mut store)?,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_for_owner(&listener, last_tick)?
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => (),
            Err(error) => return Err(Error::Io("accept owner request", error)),
        }
    }
    Ok(())
}
