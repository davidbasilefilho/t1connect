#![cfg(target_os = "linux")]

mod daemon;
mod protocol;
mod store;

pub use daemon::serve;
pub use protocol::{Operation, TaskId, help, owner_call};

use std::{fmt, io};

#[derive(Debug)]
pub enum Error {
    Usage(&'static str),
    Boundary(&'static str),
    Io(&'static str, io::Error),
    Storage(rusqlite::Error),
    Clock,
}

impl fmt::Display for Error {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Usage(message) | Self::Boundary(message) => out.write_str(message),
            Self::Io(operation, reason) => write!(out, "{operation} failed ({:?})", reason.kind()),
            Self::Storage(_) => out.write_str("could not open or update the local task journal"),
            Self::Clock => out.write_str("system clock is outside the supported range"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(_, source) => Some(source),
            Self::Storage(source) => Some(source),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

trait Context<T> {
    fn context(self, operation: &'static str) -> Result<T>;
}

impl<T> Context<T> for io::Result<T> {
    fn context(self, operation: &'static str) -> Result<T> {
        self.map_err(|error| Error::Io(operation, error))
    }
}
