//! The render worker pool (task T11; ADR 20261116-renders-run-in-killable-worker-processes-and-concurrency-is-
//! bounded-by-memory; AC-2.2, AC-3.4, AC-3.5, AC-3.7).
//!
//! Typst cannot be cancelled once a compile has started (spike F3), so a render runs in a pre-started worker
//! process (`letterhead-api worker`, see `crate::worker`) that this supervisor can kill. The pool:
//!
//! - **starts** `LH_WORKERS` workers up front, each with an empty environment, no stderr and two pipes;
//! - **admits** a job or turns it away at once: a free worker runs it, else it waits if the queue (`LH_QUEUE`) has
//!   a place and its caller holds fewer than two of them, else [`PoolError::Busy`] with a `retry_after`
//!   (AC-3.5). Admission is a separate step from the work so that a route can take its place *before* it reads
//!   and parses a 20 MiB body: [`Pool::admit`] gives a [`Permit`], [`Permit::run`] spends it;
//! - **runs** one job per worker at a time and **kills** the worker at the deadline (30 s, AC-3.4: the caller gets
//!   [`PoolError::Timeout`], the process is gone and reaped before that answer is returned) or when its resident
//!   memory passes the cap ([`PoolError::MemoryExceeded`]), then starts another in its place;
//! - kills a worker whose job future is dropped half way (a caller that went away): the work does not go on in the
//!   background;
//! - checks a worker's memory once more after each job and replaces one that has grown past the cap, so a
//!   worker that leaked past the cache eviction does not carry its weight into the next job (AC-3.7).
//!
//! - **keeps a slot for PDFs** (T48): of `LH_WORKERS = n >= 2` workers, previews and fit checks
//!   ([`Pool::admit_interactive`]) may hold at most `n - 1` at once; a PDF ([`Pool::admit`]) may hold all `n`. With
//!   `n = 1` nothing is reserved. See [`sched`].
//! - **runs the fit check too** (T48): [`Job::fit`] is a job like another, so it has the deadline and the memory
//!   cap, and what it decodes (the person's uploaded images) never runs in the supervisor.
//!
//! The memory poll is a watchdog and not a wall (an allocation that outruns one poll can pass the cap before the
//! kill): the deadline bounds the time in any case, and the request limits of AC-3.3 bound the worst job.
//!
//! What T12 calls: [`Pool::start`], then per request [`Pool::admit`] (refusal: 429 `busy`, `Retry-After`), the
//! body is read and checked, then [`Permit::run`] with a [`Job`]; [`PoolError::Timeout`] is 504 `render_timeout`.

pub mod job;
pub mod rss;
pub mod sched;
#[cfg(any(test, feature = "test-slow"))]
pub mod testing;
pub mod wire;

use std::ffi::OsString;
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::io::BufReader;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::oneshot;
use tokio::time::MissedTickBehavior;

use job::{Answer, decode_reply};
#[expect(unused_imports, reason = "the names the render routes (T12) use")]
pub use job::{Body, Job, JobOutput, Meta, Output, Refusal};
pub use sched::Class;
use sched::{Admit, Sched};
use wire::{read_frame_async, write_frame_async};

/// AC-3.4.
pub const DEFAULT_DEADLINE: Duration = Duration::from_secs(30);
/// The cap on one worker's resident memory, in MiB (`LH_WORKER_RSS_MB`).
///
/// The page limit (AC-3.3) is checked after the whole document is laid out, so a document over 300 pages has
/// reached its peak memory before it can be refused: the cap has to sit above the layout of a document that is a
/// little over the limit, or that document is killed first and answers 503 instead of 422 `too_many_pages`. At
/// 1 GiB (spike F4 had measured 855 MiB for a 220-page table) a table of 4 984 blocks just over 300 pages was
/// killed (T13). T41 measured 1.0 to 1.4 GiB on macOS; T46 measured the worker's VmHWM on Linux (the platform
/// the service runs on) at 1.53 GiB for both the 300-page table and the 301-page one (spike.md, "Not measured"),
/// so the cap is 2 GiB. Two workers at the cap and the supervisor fit the 5 GB container. A layout that passes the cap anyway (the same table with 240-character cells)
/// is still killed and answers 503. ADR 20261116-renders-run-in-killable-worker-processes-and-
/// concurrency-is-bounded-by-memory, "The memory rule", as amended by T41.
pub const DEFAULT_RSS_CAP_MB: u64 = 2048;
/// [`DEFAULT_RSS_CAP_MB`] in bytes.
pub const DEFAULT_RSS_CAP_BYTES: u64 = DEFAULT_RSS_CAP_MB * 1024 * 1024;
/// How many of the queue's places one caller may hold.
pub const DEFAULT_PER_CALLER_QUEUE: usize = 2;
/// `Retry-After` of a 429 `busy`.
pub const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(2);
/// What a worker is given beyond the deadline before it ends itself (a supervisor that died cannot kill it).
const WORKER_SELF_DEADLINE_GRACE: Duration = Duration::from_secs(2);

/// How to start a worker.
#[derive(Debug, Clone)]
pub struct WorkerCommand {
    pub program: PathBuf,
    /// Before the flags the supervisor adds: `["worker"]` for this binary.
    pub args: Vec<OsString>,
}

impl WorkerCommand {
    /// This executable, as `letterhead-api worker`.
    pub fn this_binary() -> io::Result<WorkerCommand> {
        Ok(WorkerCommand {
            program: std::env::current_exe()?,
            args: vec![OsString::from("worker")],
        })
    }
}

#[derive(Debug, Clone)]
pub struct PoolConfig {
    /// `LH_WORKERS`.
    pub workers: usize,
    /// `LH_QUEUE`: jobs that may wait for a worker.
    pub queue: usize,
    pub per_caller_queue: usize,
    /// The longest a job may run (AC-3.4). Tests shorten it.
    pub deadline: Duration,
    pub rss_cap_bytes: u64,
    pub rss_poll: Duration,
    pub retry_after: Duration,
    pub command: WorkerCommand,
}

impl PoolConfig {
    /// The values of the plan for `workers` workers and `queue` waiting places.
    pub fn new(workers: usize, queue: usize, command: WorkerCommand) -> PoolConfig {
        PoolConfig {
            workers,
            queue,
            per_caller_queue: DEFAULT_PER_CALLER_QUEUE,
            deadline: DEFAULT_DEADLINE,
            rss_cap_bytes: DEFAULT_RSS_CAP_BYTES,
            rss_poll: rss::default_poll(),
            retry_after: DEFAULT_RETRY_AFTER,
            command,
        }
    }
}

/// Why a job did not give a document. None of these carries a word of the request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PoolError {
    /// No place for this caller now: 429 `busy` with `Retry-After: retry_after` (AC-3.5). Also what a pool that
    /// is shutting down answers.
    Busy { retry_after: Duration },
    /// The job ran for the whole deadline: 504 `render_timeout` (AC-3.4). The worker was killed.
    Timeout,
    /// The worker's memory passed the cap and it was killed. The document is too much for the service.
    MemoryExceeded,
    /// The engine refused the job (a frame that does not fit, too many pages, an image it refuses...).
    Refused(Refusal),
    /// The worker died, or said something that is not a result. It was replaced.
    WorkerFailed,
    /// No worker could be started, or the pool was closed while the job waited.
    Unavailable,
}

impl std::fmt::Display for PoolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            PoolError::Busy { .. } => "busy",
            PoolError::Timeout => "render_timeout",
            PoolError::MemoryExceeded => "render_memory_exceeded",
            PoolError::Refused(refusal) => &refusal.code,
            PoolError::WorkerFailed => "worker_failed",
            PoolError::Unavailable => "worker_unavailable",
        })
    }
}

impl std::error::Error for PoolError {}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    pid: u32,
}

/// One of the pool's places to run a job: a worker, or the lack of one that the next job will make good.
struct Slot {
    worker: Option<Box<Worker>>,
}

struct Inner {
    config: PoolConfig,
    sched: Mutex<Sched<Slot>>,
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, Sched<Slot>> {
        self.sched.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn release(&self, slot: Slot, class: Class) {
        self.lock().release_as(slot, class);
    }
}

/// Starts a worker: an empty environment, nothing on stderr (a panic message can quote a template value), the two
/// pipes. `kill_on_drop` is the last resort: a worker never outlives the handle that holds it.
fn spawn_worker(config: &PoolConfig) -> io::Result<Worker> {
    let hard_deadline = config.deadline + WORKER_SELF_DEADLINE_GRACE;
    let mut child = Command::new(&config.command.program)
        .args(&config.command.args)
        .arg("--hard-deadline-ms")
        .arg(hard_deadline.as_millis().to_string())
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let pid = child
        .id()
        .ok_or_else(|| io::Error::other("worker exited at once"))?;
    match (child.stdin.take(), child.stdout.take()) {
        (Some(stdin), Some(stdout)) => Ok(Worker {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            pid,
        }),
        _ => Err(io::Error::other("worker has no pipes")),
    }
}

/// The pool. Cheap to clone: clones share the workers.
#[derive(Clone)]
pub struct Pool {
    inner: Arc<Inner>,
}

impl Pool {
    /// Starts every worker. Call it inside the Tokio runtime. An error here is a startup failure: the binary or
    /// the machine cannot run workers.
    pub fn start(config: PoolConfig) -> io::Result<Pool> {
        let mut slots = Vec::with_capacity(config.workers);
        for _ in 0..config.workers {
            slots.push(Slot {
                worker: Some(Box::new(spawn_worker(&config)?)),
            });
        }
        let sched = Sched::new(slots, config.queue, config.per_caller_queue);
        Ok(Pool {
            inner: Arc::new(Inner {
                config,
                sched: Mutex::new(sched),
            }),
        })
    }

    /// Takes a place for `caller` (the verified service identity, never a claimed one), or says there is none.
    /// The place is held until the permit is spent or dropped. Never waits; the only error is
    /// [`PoolError::Busy`].
    pub fn admit(&self, caller: &str) -> Result<Permit, PoolError> {
        self.admit_as(caller, Class::Pdf)
    }

    /// [`Pool::admit`] for a preview or a fit check: it may not take the last slot the PDFs are kept (with two
    /// or more workers), so it can be turned away or made to wait where a PDF would run.
    pub fn admit_interactive(&self, caller: &str) -> Result<Permit, PoolError> {
        self.admit_as(caller, Class::Interactive)
    }

    fn admit_as(&self, caller: &str, class: Class) -> Result<Permit, PoolError> {
        let admitted = self.inner.lock().admit_as(caller, class);
        let state = match admitted {
            Admit::Ready(slot) => State::Ready(slot),
            Admit::Wait { id, rx } => State::Waiting { id, rx },
            Admit::Busy => {
                return Err(PoolError::Busy {
                    retry_after: self.inner.config.retry_after,
                });
            }
        };
        Ok(Permit {
            pool: Arc::clone(&self.inner),
            state,
            class,
        })
    }

    /// [`Pool::admit`] then [`Permit::run`].
    pub async fn render(&self, caller: &str, job: Job) -> Result<JobOutput, PoolError> {
        self.admit(caller)?.run(job).await
    }

    /// The pids of the workers that are idle now.
    pub fn idle_pids(&self) -> Vec<u32> {
        self.inner
            .lock()
            .idle()
            .iter()
            .filter_map(|slot| slot.worker.as_ref().map(|w| w.pid))
            .collect()
    }

    /// How many jobs wait for a worker.
    pub fn waiting(&self) -> usize {
        self.inner.lock().waiting()
    }

    /// Stops admitting, lets go of the waiting jobs (they get [`PoolError::Unavailable`]) and kills the idle
    /// workers. A job that is running finishes, and its worker is killed when it comes back.
    pub fn shutdown(&self) {
        let idle = self.inner.lock().close();
        drop(idle);
    }
}

enum State {
    Ready(Slot),
    Waiting {
        id: u64,
        rx: oneshot::Receiver<Slot>,
    },
    Spent,
}

/// A place in the pool, taken by [`Pool::admit`]. Dropping it gives the place back.
pub struct Permit {
    pool: Arc<Inner>,
    state: State,
    class: Class,
}

impl Permit {
    /// Runs `job`: waits for a worker if it has none yet, then renders. If this future is dropped, the job is
    /// stopped (the worker is killed) and the place is given back.
    pub async fn run(mut self, job: Job) -> Result<JobOutput, PoolError> {
        let slot = if let State::Waiting { rx, .. } = &mut self.state {
            // The receiver stays in `self.state` while awaited, so a dropped future still gives the place back.
            let received = rx.await;
            self.state = State::Spent;
            received.map_err(|_| PoolError::Unavailable)?
        } else {
            match std::mem::replace(&mut self.state, State::Spent) {
                State::Ready(slot) => slot,
                _ => return Err(PoolError::Unavailable),
            }
        };
        let mut lease = Lease {
            pool: Arc::clone(&self.pool),
            slot: Some(slot),
            in_flight: false,
            class: self.class,
        };
        lease.execute(job).await
    }
}

impl Drop for Permit {
    fn drop(&mut self) {
        match std::mem::replace(&mut self.state, State::Spent) {
            State::Ready(slot) => self.pool.release(slot, self.class),
            State::Waiting { id, mut rx } => {
                // Close first: from here a slot cannot be sent to us, and one that already was is in the channel.
                rx.close();
                if let Ok(slot) = rx.try_recv() {
                    self.pool.release(slot, self.class);
                }
                self.pool.lock().cancel(id);
            }
            State::Spent => {}
        }
    }
}

/// A slot while a job runs on it. Giving it back is automatic; a job that was cut short kills its worker.
struct Lease {
    pool: Arc<Inner>,
    slot: Option<Slot>,
    /// A job was handed to the worker and its answer has not been taken in: the worker is mid-job.
    in_flight: bool,
    class: Class,
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(mut slot) = self.slot.take() {
            if self.in_flight
                && let Some(mut worker) = slot.worker.take()
            {
                // The future was dropped mid-job: whoever asked has gone, and the work must not go on.
                let _ = worker.child.start_kill();
            }
            self.pool.release(slot, self.class);
        }
    }
}

/// How the exchange with a worker ended.
enum Exchange {
    Frame(Vec<Vec<u8>>),
    Timeout,
    Memory,
    Broken,
}

impl Lease {
    fn slot(&mut self) -> &mut Slot {
        self.slot.as_mut().expect("a lease holds its slot")
    }

    async fn execute(&mut self, job: Job) -> Result<JobOutput, PoolError> {
        let config = self.pool.config.clone();
        self.ensure_worker(&config)?;
        let (header, assets) = job.encode().map_err(|_| PoolError::WorkerFailed)?;
        let mut parts: Vec<&[u8]> = Vec::with_capacity(1 + assets.len());
        parts.push(&header);
        parts.extend(assets);

        self.in_flight = true;
        let exchange = match self.slot().worker.as_mut() {
            Some(worker) => converse(worker, &parts, &config).await,
            None => Exchange::Broken,
        };
        drop(parts);
        drop(header);
        match exchange {
            Exchange::Frame(frame) => {
                self.in_flight = false;
                let answer = decode_reply(frame);
                match answer {
                    Ok(Answer::Done(output)) => {
                        self.recycle_if_fat(&config).await;
                        Ok(output)
                    }
                    Ok(Answer::Refused(refusal)) => {
                        self.recycle_if_fat(&config).await;
                        Err(PoolError::Refused(refusal))
                    }
                    Ok(Answer::Failed) | Err(_) => {
                        self.replace_worker(&config).await;
                        Err(PoolError::WorkerFailed)
                    }
                }
            }
            Exchange::Timeout => {
                self.replace_worker(&config).await;
                Err(PoolError::Timeout)
            }
            Exchange::Memory => {
                self.replace_worker(&config).await;
                Err(PoolError::MemoryExceeded)
            }
            Exchange::Broken => {
                self.replace_worker(&config).await;
                Err(PoolError::WorkerFailed)
            }
        }
    }

    /// A worker that is there and alive, or a new one.
    fn ensure_worker(&mut self, config: &PoolConfig) -> Result<(), PoolError> {
        let slot = self.slot();
        if let Some(worker) = slot.worker.as_mut() {
            // A worker that died between jobs (the OOM killer, a crash) is replaced, not given a job.
            if !matches!(worker.child.try_wait(), Ok(None)) {
                slot.worker = None;
            }
        }
        if slot.worker.is_none() {
            slot.worker = Some(Box::new(
                spawn_worker(config).map_err(|_| PoolError::Unavailable)?,
            ));
        }
        Ok(())
    }

    /// Kills the worker and waits until it is gone (so its pid is free when the caller is told), then starts the
    /// next one. If that cannot start, the slot is empty and the next job tries again.
    async fn replace_worker(&mut self, config: &PoolConfig) {
        if let Some(mut worker) = self.slot().worker.take() {
            let _ = worker.child.kill().await;
        }
        self.in_flight = false;
        self.slot().worker = spawn_worker(config).ok().map(Box::new);
    }

    /// After a job: a worker whose memory is past the cap is replaced, so what it still holds is not carried into
    /// the next job.
    async fn recycle_if_fat(&mut self, config: &PoolConfig) {
        let Some(pid) = self.slot().worker.as_ref().map(|w| w.pid) else {
            return;
        };
        if let Some(rss) = rss::resident_bytes(pid).await
            && rss > config.rss_cap_bytes
        {
            self.replace_worker(config).await;
        }
    }
}

/// Sends the job and waits for the answer, under the deadline and the memory cap.
async fn converse(worker: &mut Worker, parts: &[&[u8]], config: &PoolConfig) -> Exchange {
    let Worker {
        stdin, stdout, pid, ..
    } = worker;
    let pid = *pid;
    let io = async {
        write_frame_async(stdin, parts).await.map_err(|_| ())?;
        match read_frame_async(stdout).await {
            Ok(Some(frame)) => Ok(frame),
            _ => Err(()),
        }
    };
    tokio::pin!(io);
    let deadline = tokio::time::sleep(config.deadline);
    tokio::pin!(deadline);
    let mut poll = tokio::time::interval(config.rss_poll);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            result = &mut io => {
                return match result {
                    Ok(frame) => Exchange::Frame(frame),
                    Err(()) => Exchange::Broken,
                };
            }
            () = &mut deadline => return Exchange::Timeout,
            _ = poll.tick() => {
                if let Some(rss) = rss::resident_bytes(pid).await
                    && rss > config.rss_cap_bytes
                {
                    return Exchange::Memory;
                }
            }
        }
    }
}
