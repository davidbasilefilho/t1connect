use std::{
    ffi::OsStr,
    io::{self, Write},
    path::Path,
    process::ExitCode,
};
use t1_local_host::{Error, Operation, Result, TaskId, help, owner_call};

const USAGE: &str = "usage: t1-hostctl OWNER_RUNTIME_DIR health | start TASK_ID";

fn run() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    match (args.next(), args.next(), args.next(), args.next()) {
        (Some(flag), None, None, None) if flag == OsStr::new("--version") => {
            help(concat!("t1-hostctl ", env!("CARGO_PKG_VERSION")))
        }
        (Some(flag), None, None, None) if flag == OsStr::new("--help") => help(USAGE),
        (Some(runtime), Some(action), None, None) if action == OsStr::new("health") => {
            help(owner_call(Path::new(&runtime), Operation::Health)?)
        }
        (Some(runtime), Some(action), Some(task), None) if action == OsStr::new("start") => {
            let id = TaskId::parse(task.to_str().ok_or(Error::Usage("task ID must be UTF-8"))?)?;
            help(owner_call(Path::new(&runtime), Operation::Start(id))?)
        }
        _ => Err(Error::Usage(USAGE)),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "t1-hostctl: {error}");
            if matches!(error, Error::Usage(_)) {
                ExitCode::from(2)
            } else {
                ExitCode::FAILURE
            }
        }
    }
}
