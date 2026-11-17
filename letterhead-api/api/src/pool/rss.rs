//! The resident memory of a worker, read from outside (ADR 20261116-renders-run-in-killable-worker-processes...:
//! the poll is a watchdog and not a wall).
//!
//! - Linux: `VmRSS` of `/proc/<pid>/status`, a file read, polled every 20 ms.
//! - Everywhere else (macOS in development): `ps -o rss= -p <pid>`, a spawn, polled every 100 ms. The service is
//!   deployed on Linux; the other path is for a developer's machine and is slower and coarser, not different in
//!   what it enforces.
//!
//! No `unsafe` and no `libc`: the workspace forbids the first and the engine's tripwire the second.

use std::time::Duration;

use tokio::process::Command;

/// How often a running worker's memory is read.
pub const fn default_poll() -> Duration {
    if cfg!(target_os = "linux") {
        Duration::from_millis(20)
    } else {
        Duration::from_millis(100)
    }
}

/// The resident set of process `pid` in bytes, or `None` if it cannot be read (the process is gone, or the
/// platform does not say). A `None` never kills a worker: the deadline still holds.
pub async fn resident_bytes(pid: u32) -> Option<u64> {
    if cfg!(target_os = "linux") {
        let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
        parse_proc_status(&status)
    } else {
        let output = tokio::time::timeout(
            Duration::from_secs(1),
            Command::new("ps")
                .args(["-o", "rss=", "-p", &pid.to_string()])
                .env_clear()
                .kill_on_drop(true)
                .output(),
        )
        .await
        .ok()?
        .ok()?;
        if !output.status.success() {
            return None;
        }
        parse_ps(&String::from_utf8_lossy(&output.stdout))
    }
}

/// `VmRSS:   1234 kB` of `/proc/<pid>/status`.
pub fn parse_proc_status(status: &str) -> Option<u64> {
    let line = status.lines().find(|l| l.starts_with("VmRSS:"))?;
    let mut fields = line.split_whitespace().skip(1);
    let kib: u64 = fields.next()?.parse().ok()?;
    match fields.next() {
        Some("kB") | None => kib.checked_mul(1024),
        Some(_) => None,
    }
}

/// The output of `ps -o rss=`: kibibytes, alone on a line.
pub fn parse_ps(output: &str) -> Option<u64> {
    let kib: u64 = output.trim().parse().ok()?;
    kib.checked_mul(1024)
}
