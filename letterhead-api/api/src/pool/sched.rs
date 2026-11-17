//! Who runs now, who waits, who is turned away (AC-3.5). Pure: a list of slots, a queue, counts. It decides under
//! one lock and never waits, so the decision is exact: a place is taken or refused at the moment of asking.
//!
//! - A free slot runs the job at once. Nothing waits while a slot is free.
//! - Otherwise the job waits, if the queue has a place (`LH_QUEUE`) and the caller holds fewer than `per_caller`
//!   of the waiting places (2: the pattern of crm-api's isolated PDF check). Otherwise it is turned away.
//! - A slot that comes back goes to the longest-waiting job: no job overtakes another.
//!
//! **The reserved slot (T48, security review F1).** A job is of one of two classes ([`Class`]): a PDF render, and
//! an interactive job (a preview, the fit check of a save). With `n >= 2` slots the interactive jobs may hold at
//! most `n - 1` of them at once, so one slot can only ever be taken by a PDF: a flood of previews cannot keep a
//! document from being generated. A PDF may use all `n`. With `n = 1` there is nothing to reserve and both
//! classes share the one slot. An interactive job that has no right to a free slot waits like any other, and a
//! returning slot goes to the longest-waiting job *that may have it*: a PDF behind interactive jobs that are over
//! their limit is served first.
//!
//! The caller's running jobs are not counted: at most `LH_WORKERS` of them can exist. The per-caller share is of
//! the queue, so one caller can fill the workers and two places of the queue, and the rest of the queue is
//! another caller's.

use std::collections::{HashMap, VecDeque};

use tokio::sync::oneshot;

/// What a job is, for the reserved slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    /// The PDF of a document: may use every slot.
    Pdf,
    /// A preview or a fit check: may use all but one slot (when there are two or more).
    Interactive,
}

struct Waiter<S> {
    id: u64,
    caller: String,
    class: Class,
    tx: oneshot::Sender<S>,
}

/// The answer to a request for a place.
pub enum Admit<S> {
    /// A slot is free: the job runs on it.
    Ready(S),
    /// The job waits: the slot arrives on `rx`. `id` is the place in the queue (for [`Sched::cancel`]).
    Wait { id: u64, rx: oneshot::Receiver<S> },
    /// No place for this caller now.
    Busy,
}

pub struct Sched<S> {
    idle: Vec<S>,
    queue: VecDeque<Waiter<S>>,
    max_queue: usize,
    per_caller: usize,
    waiting_by_caller: HashMap<String, usize>,
    next_id: u64,
    closed: bool,
    /// How many interactive jobs may hold a slot: `n - 1` of `n >= 2`, else `n`.
    interactive_limit: usize,
    /// How many slots interactive jobs hold now (running, or handed to one that has not started).
    interactive_running: usize,
}

impl<S> Sched<S> {
    pub fn new(slots: Vec<S>, max_queue: usize, per_caller: usize) -> Sched<S> {
        let total = slots.len();
        Sched {
            idle: slots,
            queue: VecDeque::new(),
            max_queue,
            per_caller,
            waiting_by_caller: HashMap::new(),
            next_id: 0,
            closed: false,
            interactive_limit: if total >= 2 { total - 1 } else { total },
            interactive_running: 0,
        }
    }

    /// [`Sched::admit_as`] for a PDF.
    pub fn admit(&mut self, caller: &str) -> Admit<S> {
        self.admit_as(caller, Class::Pdf)
    }

    fn may_start(&self, class: Class) -> bool {
        class == Class::Pdf || self.interactive_running < self.interactive_limit
    }

    pub fn admit_as(&mut self, caller: &str, class: Class) -> Admit<S> {
        if self.closed {
            return Admit::Busy;
        }
        if self.may_start(class)
            && let Some(slot) = self.idle.pop()
        {
            if class == Class::Interactive {
                self.interactive_running += 1;
            }
            return Admit::Ready(slot);
        }
        let held = self.waiting_by_caller.get(caller).copied().unwrap_or(0);
        if self.queue.len() >= self.max_queue || held >= self.per_caller {
            return Admit::Busy;
        }
        let (tx, rx) = oneshot::channel();
        let id = self.next_id;
        self.next_id += 1;
        *self.waiting_by_caller.entry(caller.to_owned()).or_insert(0) += 1;
        self.queue.push_back(Waiter {
            id,
            caller: caller.to_owned(),
            class,
            tx,
        });
        Admit::Wait { id, rx }
    }

    /// [`Sched::release_as`] for a PDF.
    pub fn release(&mut self, slot: S) {
        self.release_as(slot, Class::Pdf);
    }

    /// A slot comes back from a job of `class`: to the longest-waiting job that is still there and may have it,
    /// else to the idle list. After [`Sched::close`] it is dropped.
    pub fn release_as(&mut self, slot: S, class: Class) {
        if self.closed {
            return;
        }
        if class == Class::Interactive {
            self.interactive_running = self.interactive_running.saturating_sub(1);
        }
        let mut slot = slot;
        let mut at = 0;
        while at < self.queue.len() {
            if !self.may_start(self.queue[at].class) {
                at += 1;
                continue;
            }
            let Some(waiter) = self.queue.remove(at) else {
                break;
            };
            self.leave(&waiter.caller);
            match waiter.tx.send(slot) {
                Ok(()) => {
                    if waiter.class == Class::Interactive {
                        self.interactive_running += 1;
                    }
                    return;
                }
                // The job stopped waiting (its receiver is closed): the next one is next.
                Err(back) => slot = back,
            }
        }
        self.idle.push(slot);
    }

    /// A waiting job gives up its place. Nothing if it was already given a slot.
    pub fn cancel(&mut self, id: u64) {
        if let Some(at) = self.queue.iter().position(|w| w.id == id)
            && let Some(waiter) = self.queue.remove(at)
        {
            self.leave(&waiter.caller);
        }
    }

    /// No new job is admitted and every waiting job is let go. The idle slots are returned to be dropped.
    pub fn close(&mut self) -> Vec<S> {
        self.closed = true;
        self.queue.clear();
        self.waiting_by_caller.clear();
        std::mem::take(&mut self.idle)
    }

    pub fn idle(&self) -> &[S] {
        &self.idle
    }

    pub fn waiting(&self) -> usize {
        self.queue.len()
    }

    fn leave(&mut self, caller: &str) {
        if let Some(count) = self.waiting_by_caller.get_mut(caller) {
            *count -= 1;
            if *count == 0 {
                self.waiting_by_caller.remove(caller);
            }
        }
    }
}
