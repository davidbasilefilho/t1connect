use std::{
    ffi::OsStr,
    io::{self, Write},
    path::Path,
    process::ExitCode,
};
use t1_local_host::{Error, Result, help, serve};

fn run() -> Result<()> {
    let mut arguments = std::env::args_os().skip(1);
    match (arguments.next(), arguments.next(), arguments.next()) {
        (Some(flag), None, None) if flag == OsStr::new("--version") => {
            help(concat!("t1-hostd ", env!("CARGO_PKG_VERSION")))
        }
        (Some(flag), None, None) if flag == OsStr::new("--help") => {
            help("usage: t1-hostd STATE_DIR OWNER_RUNTIME_DIR")
        }
        (Some(state), Some(runtime), None) => serve(Path::new(&state), Path::new(&runtime)),
        _ => Err(Error::Usage(
            "usage: t1-hostd STATE_DIR OWNER_RUNTIME_DIR (see --help)",
        )),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "t1-hostd: {error}");
            if matches!(error, Error::Usage(_)) {
                ExitCode::from(2)
            } else {
                ExitCode::FAILURE
            }
        }
    }
}
