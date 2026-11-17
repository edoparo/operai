//! The frame the supervisor and a worker exchange over the worker's stdin and stdout (task T11).
//!
//! A frame is a sequence of byte strings, each with its length written before it, so nothing in a job can be
//! mistaken for the end of one: the content of a document is only ever bytes between two lengths.
//!
//! ```text
//! frame = "LHW1" | count: u32 BE | count x ( len: u64 BE | len bytes )
//! ```
//!
//! Both sides refuse a frame that does not start with the magic, names more than [`MAX_PARTS`] parts or more than
//! [`MAX_FRAME_BYTES`] bytes in all, or ends early. A refused frame is the end of that worker: the supervisor
//! kills it and starts another, and a worker that reads one exits.
//!
//! This file is shared by the worker, so it is held to the worker's rule (a test checks it): no socket, no file,
//! no program. The only streams it touches are the ones it is handed.

use std::io::{self, Read, Write};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const MAGIC: [u8; 4] = *b"LHW1";

/// The most a frame may carry, in all. The largest accepted request is 20 MiB (AC-3.3), a result of 300 preview
/// pages is about 20 MiB, so this is a bound on a fault and not a limit anyone meets.
pub const MAX_FRAME_BYTES: u64 = 256 * 1024 * 1024;

/// The most parts a frame may have: one header and, in a job, the assets of a letterhead; in a result, a PDF or
/// the pages (at most 300) of a preview.
pub const MAX_PARTS: u32 = 4096;

/// Why a frame could not be read.
#[derive(Debug)]
pub enum FrameError {
    /// The stream failed, or ended in the middle of a frame.
    Io(io::Error),
    /// What was read is not a frame, or is one that exceeds the bounds.
    Corrupt,
}

impl From<io::Error> for FrameError {
    fn from(error: io::Error) -> FrameError {
        FrameError::Io(error)
    }
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::Io(_) => f.write_str("worker stream failed"),
            FrameError::Corrupt => f.write_str("worker frame is corrupt"),
        }
    }
}

impl std::error::Error for FrameError {}

fn header(count: usize) -> io::Result<[u8; 8]> {
    let count = u32::try_from(count)
        .ok()
        .filter(|&c| c <= MAX_PARTS)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "too many parts"))?;
    let mut out = [0u8; 8];
    out[..4].copy_from_slice(&MAGIC);
    out[4..].copy_from_slice(&count.to_be_bytes());
    Ok(out)
}

fn check_total(parts: &[&[u8]]) -> io::Result<()> {
    let total: u64 = parts.iter().map(|p| p.len() as u64).sum();
    if total > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "frame too large",
        ));
    }
    Ok(())
}

/// Write one frame and flush it.
pub fn write_frame<W: Write>(out: &mut W, parts: &[&[u8]]) -> io::Result<()> {
    check_total(parts)?;
    out.write_all(&header(parts.len())?)?;
    for part in parts {
        out.write_all(&(part.len() as u64).to_be_bytes())?;
        out.write_all(part)?;
    }
    out.flush()
}

/// Write one frame and flush it, on an async stream.
pub async fn write_frame_async<W: AsyncWrite + Unpin>(
    out: &mut W,
    parts: &[&[u8]],
) -> io::Result<()> {
    check_total(parts)?;
    out.write_all(&header(parts.len())?).await?;
    for part in parts {
        out.write_all(&(part.len() as u64).to_be_bytes()).await?;
        out.write_all(part).await?;
    }
    out.flush().await
}

/// What is left of the budget after a part of this length, or `None` if it does not fit.
fn take_budget(budget: u64, len: u64) -> Option<u64> {
    budget.checked_sub(len)
}

fn parse_count(head: [u8; 8]) -> Result<u32, FrameError> {
    if head[..4] != MAGIC {
        return Err(FrameError::Corrupt);
    }
    let count = u32::from_be_bytes([head[4], head[5], head[6], head[7]]);
    if count > MAX_PARTS {
        return Err(FrameError::Corrupt);
    }
    Ok(count)
}

/// Read one frame. `Ok(None)` is the stream's end before the first byte of a frame: the other side closed it.
pub fn read_frame<R: Read>(input: &mut R) -> Result<Option<Vec<Vec<u8>>>, FrameError> {
    let mut head = [0u8; 8];
    let mut got = 0;
    while got < head.len() {
        match input.read(&mut head[got..]) {
            Ok(0) if got == 0 => return Ok(None),
            Ok(0) => return Err(FrameError::Io(io::ErrorKind::UnexpectedEof.into())),
            Ok(n) => got += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e.into()),
        }
    }
    let count = parse_count(head)?;
    let mut budget = MAX_FRAME_BYTES;
    let mut parts = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let mut len = [0u8; 8];
        input.read_exact(&mut len)?;
        let len = u64::from_be_bytes(len);
        budget = take_budget(budget, len).ok_or(FrameError::Corrupt)?;
        // `take` + `read_to_end`: memory grows with the bytes that arrive, not with the length a peer claims.
        let mut part = Vec::new();
        input.by_ref().take(len).read_to_end(&mut part)?;
        if part.len() as u64 != len {
            return Err(FrameError::Io(io::ErrorKind::UnexpectedEof.into()));
        }
        parts.push(part);
    }
    Ok(Some(parts))
}

/// Read one frame from an async stream. `Ok(None)` as for [`read_frame`].
pub async fn read_frame_async<R: AsyncRead + Unpin>(
    input: &mut R,
) -> Result<Option<Vec<Vec<u8>>>, FrameError> {
    let mut head = [0u8; 8];
    let mut got = 0;
    while got < head.len() {
        match input.read(&mut head[got..]).await? {
            0 if got == 0 => return Ok(None),
            0 => return Err(FrameError::Io(io::ErrorKind::UnexpectedEof.into())),
            n => got += n,
        }
    }
    let count = parse_count(head)?;
    let mut budget = MAX_FRAME_BYTES;
    let mut parts = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let mut len = [0u8; 8];
        input.read_exact(&mut len).await?;
        let len = u64::from_be_bytes(len);
        budget = take_budget(budget, len).ok_or(FrameError::Corrupt)?;
        let mut part = Vec::new();
        (&mut *input).take(len).read_to_end(&mut part).await?;
        if part.len() as u64 != len {
            return Err(FrameError::Io(io::ErrorKind::UnexpectedEof.into()));
        }
        parts.push(part);
    }
    Ok(Some(parts))
}
