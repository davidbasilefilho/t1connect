use crate::{Context, Error, Result, daemon::validate_directory};
use std::{
    fs,
    io::{Read, Write},
    os::unix::{
        fs::{FileTypeExt, MetadataExt},
        net::UnixStream,
    },
    path::Path,
    time::{Duration, Instant},
};

const LIMIT: usize = 4096;
const DEADLINE: Duration = Duration::from_millis(250);

#[derive(Debug)]
pub struct TaskId<'a>(&'a str);

impl<'a> TaskId<'a> {
    pub fn parse(value: &'a str) -> Result<Self> {
        if value.len() == 36
            && value.bytes().enumerate().all(|(i, b)| {
                if matches!(i, 8 | 13 | 18 | 23) {
                    b == b'-'
                } else {
                    matches!(b, b'0'..=b'9' | b'a'..=b'f')
                }
            })
        {
            Ok(Self(value))
        } else {
            Err(Error::Usage("task must be a canonical lowercase UUID"))
        }
    }

    pub(crate) fn as_str(&self) -> &str {
        self.0
    }
}

pub enum Operation<'a> {
    Health,
    Start(TaskId<'a>),
}

impl Operation<'_> {
    fn request(&self) -> String {
        let (method, path) = match self {
            Self::Health => ("GET", "/health".to_owned()),
            Self::Start(id) => ("POST", format!("/start/{}", id.as_str())),
        };
        format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
        )
    }
}

#[derive(Debug)]
pub(crate) enum Inbound<'a> {
    Health,
    Start(TaskId<'a>),
    NotFound,
    Invalid,
}

pub(crate) fn parse_request(bytes: &[u8]) -> Inbound<'_> {
    let mut headers = [httparse::EMPTY_HEADER; 24];
    let mut request = httparse::Request::new(&mut headers);
    let Ok(httparse::Status::Complete(end)) = request.parse(bytes) else {
        return Inbound::Invalid;
    };
    if end != bytes.len() {
        return Inbound::Invalid;
    }
    let mut length_present = false;
    for header in request.headers {
        if header.name.eq_ignore_ascii_case("origin")
            || header.name.eq_ignore_ascii_case("transfer-encoding")
            || header.name.eq_ignore_ascii_case("upgrade")
        {
            return Inbound::Invalid;
        }
        if header.name.eq_ignore_ascii_case("content-length") {
            if length_present || header.value != b"0" {
                return Inbound::Invalid;
            }
            length_present = true;
        }
    }
    match (request.method, request.path) {
        (Some("GET"), Some("/health")) => Inbound::Health,
        (Some("POST"), Some(path)) => match path
            .strip_prefix("/start/")
            .and_then(|id| TaskId::parse(id).ok())
        {
            Some(id) => Inbound::Start(id),
            None => Inbound::NotFound,
        },
        _ => Inbound::NotFound,
    }
}

pub(crate) fn read_request(stream: &mut UnixStream) -> Result<Vec<u8>> {
    let start = Instant::now();
    let mut bytes = Vec::with_capacity(512);
    let mut chunk = [0; 512];
    loop {
        let remaining = DEADLINE.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return Err(Error::Boundary("owner request timed out"));
        }
        stream
            .set_read_timeout(Some(remaining))
            .context("set owner timeout")?;
        let n = stream.read(&mut chunk).context("read owner request")?;
        if n == 0 || bytes.len().saturating_add(n) > LIMIT {
            return Err(Error::Boundary("incomplete or oversized owner request"));
        }
        let received = chunk
            .get(..n)
            .ok_or(Error::Boundary("invalid read length"))?;
        bytes.extend_from_slice(received);
        if bytes.windows(4).any(|part| part == b"\r\n\r\n") {
            return Ok(bytes);
        }
    }
}

pub(crate) fn reply(stream: &mut UnixStream, status: &str, body: &str) -> Result<()> {
    stream
        .set_write_timeout(Some(DEADLINE))
        .context("set owner write timeout")?;
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
    .context("write owner response")
}

pub fn owner_call(directory: &Path, operation: Operation<'_>) -> Result<&'static str> {
    validate_directory(directory)?;
    let socket = directory.join("owner.sock");
    let metadata = fs::symlink_metadata(&socket).context("inspect owner socket")?;
    if !metadata.file_type().is_socket()
        || metadata.mode() & 0o777 != 0o600
        || metadata.uid() != rustix::process::geteuid().as_raw()
    {
        return Err(Error::Boundary(
            "owner socket is not private to the current user",
        ));
    }
    let mut stream = UnixStream::connect(socket).context("connect owner socket")?;
    stream
        .set_write_timeout(Some(DEADLINE))
        .context("set owner write timeout")?;
    stream
        .set_read_timeout(Some(DEADLINE))
        .context("set owner read timeout")?;
    stream
        .write_all(operation.request().as_bytes())
        .context("send owner request")?;
    let mut data = Vec::new();
    stream
        .take(4096)
        .read_to_end(&mut data)
        .context("read owner response")?;
    let mut headers = [httparse::EMPTY_HEADER; 24];
    let mut response = httparse::Response::new(&mut headers);
    let httparse::Status::Complete(end) = response
        .parse(&data)
        .map_err(|_| Error::Boundary("invalid owner response"))?
    else {
        return Err(Error::Boundary("incomplete owner response"));
    };
    match (operation, response.code, data.get(end..)) {
        (Operation::Health, Some(200), Some(br#"{"status":"ready","protocol":1}"#)) => Ok("ready"),
        (Operation::Start(_), Some(200), Some(br#"{"status":"started"}"#)) => Ok("started"),
        (Operation::Start(_), Some(200), Some(br#"{"status":"existing"}"#)) => Ok("existing"),
        (Operation::Start(_), Some(409), _) => Err(Error::Boundary("task capacity reached")),
        _ => Err(Error::Boundary(
            "owner request did not return an expected response",
        )),
    }
}

pub fn help(text: &str) -> Result<()> {
    writeln!(std::io::stdout().lock(), "{text}").context("write command output")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_declared_owner_subset() {
        assert!(matches!(
            parse_request(b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n"),
            Inbound::Health
        ));
        assert!(matches!(parse_request(b"POST /start/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee HTTP/1.1\r\nContent-Length: 0\r\n\r\n"), Inbound::Start(_)));
        assert!(matches!(
            parse_request(b"GET /health HTTP/1.1\r\nOrigin: https://example.invalid\r\n\r\n"),
            Inbound::Invalid
        ));
        assert!(matches!(
            parse_request(b"POST /approve/test HTTP/1.1\r\nHost: localhost\r\n\r\n"),
            Inbound::NotFound
        ));
    }
}
