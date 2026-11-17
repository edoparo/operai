//! Tests of the render worker pool (task T11; AC-2.2, AC-3.4, AC-3.5, AC-3.7).
//!
//! This target has no libtest harness (`harness = false`, see Cargo.toml). Its binary is a test runner *and* a
//! worker: started as `pool worker`, it is `letterhead-api worker` built with the test layouts (a render that
//! loops, holds, allocates, panics or reports its environment), which the image's binary does not have. So the
//! plain `cargo test --workspace --locked` runs every test, with no feature flag, and the supervisor under test is
//! the one the service uses. Two tests start the real binary (`CARGO_BIN_EXE_letterhead-api`) instead: one shows
//! that it refuses a test layout, one that it renders and, under a sandbox that kills it on any network or file
//! write, makes none.
//!
//! The pool and worker sources are compiled into this crate with `#[path]`, because the API crate is a binary and
//! an integration test cannot link a binary.

#[expect(
    dead_code,
    reason = "this binary compiles the whole pool and calls the part that the tests reach"
)]
#[path = "../src/pool/mod.rs"]
mod pool;
#[path = "../src/worker.rs"]
mod worker;

use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

use letterhead_engine::config::{LetterheadConfig, default_config};
use letterhead_engine::content::{RenderRequest, parse_request};
use letterhead_engine::layout::Assets;
use letterhead_engine::output::PageSelection;
use letterhead_engine::render::{LetterheadVersion, render};

use pool::job::{Answer, Reply, TestLayout, decode_reply};
use pool::wire::{self, FrameError, read_frame, write_frame};
use pool::{Body, Job, Output, Pool, PoolConfig, PoolError, WorkerCommand};

// ---------------------------------------------------------------------------------------------------------------
// The runner

type Test = (&'static str, fn());

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("worker") {
        return worker::run(&args[1..]);
    }
    let filters: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    let tests = tests();
    let selected: Vec<&Test> = tests
        .iter()
        .filter(|(name, _)| filters.is_empty() || filters.iter().any(|f| name.contains(f.as_str())))
        .collect();
    println!("\nrunning {} tests", selected.len());
    let mut failed = Vec::new();
    for (name, test) in &selected {
        let started = Instant::now();
        let outcome = catch_unwind(AssertUnwindSafe(test));
        let seconds = started.elapsed().as_secs_f64();
        match outcome {
            Ok(()) => println!("test {name} ... ok ({seconds:.1}s)"),
            Err(_) => {
                println!("test {name} ... FAILED ({seconds:.1}s)");
                failed.push(*name);
            }
        }
    }
    println!(
        "\ntest result: {}. {} passed; {} failed; {} filtered out\n",
        if failed.is_empty() { "ok" } else { "FAILED" },
        selected.len() - failed.len(),
        failed.len(),
        tests.len() - selected.len()
    );
    if failed.is_empty() {
        ExitCode::SUCCESS
    } else {
        for name in failed {
            println!("failed: {name}");
        }
        ExitCode::FAILURE
    }
}

fn tests() -> Vec<Test> {
    vec![
        // Admission, with no process.
        (
            "sched_a_free_slot_runs_the_job_at_once",
            sched_a_free_slot_runs_the_job_at_once,
        ),
        (
            "sched_bounds_the_queue_and_each_callers_share_of_it",
            sched_bounds_the_queue_and_each_callers_share_of_it,
        ),
        (
            "sched_hands_a_slot_to_the_longest_waiting_job",
            sched_hands_a_slot_to_the_longest_waiting_job,
        ),
        (
            "sched_close_lets_go_of_the_waiting",
            sched_close_lets_go_of_the_waiting,
        ),
        (
            "sched_keeps_the_last_slot_for_pdfs_and_a_pdf_overtakes_interactive_waiters",
            sched_keeps_the_last_slot_for_pdfs_and_a_pdf_overtakes_interactive_waiters,
        ),
        (
            "sched_with_one_slot_reserves_nothing",
            sched_with_one_slot_reserves_nothing,
        ),
        (
            "sched_a_returning_interactive_slot_lets_the_next_interactive_job_in",
            sched_a_returning_interactive_slot_lets_the_next_interactive_job_in,
        ),
        // The frame and the job codec.
        (
            "wire_job_content_cannot_be_taken_for_framing",
            wire_job_content_cannot_be_taken_for_framing,
        ),
        (
            "wire_refuses_what_is_not_a_frame",
            wire_refuses_what_is_not_a_frame,
        ),
        ("wire_async_matches_sync", wire_async_matches_sync),
        (
            "job_codec_round_trips_and_sends_only_the_assets_in_use",
            job_codec_round_trips_and_sends_only_the_assets_in_use,
        ),
        (
            "job_codec_carries_a_fit_check_without_a_request_and_refuses_a_document_without_one",
            job_codec_carries_a_fit_check_without_a_request_and_refuses_a_document_without_one,
        ),
        (
            "rss_readings_parse_and_a_live_process_has_some",
            rss_readings_parse_and_a_live_process_has_some,
        ),
        // The pool, with the test worker.
        (
            "pool_renders_what_the_engine_renders",
            pool_renders_what_the_engine_renders,
        ),
        (
            "pool_passes_an_engine_refusal_with_code_and_path_only",
            pool_passes_an_engine_refusal_with_code_and_path_only,
        ),
        (
            "pool_worker_has_an_empty_environment",
            pool_worker_has_an_empty_environment,
        ),
        (
            "pool_looping_render_times_out_its_pid_is_gone_and_the_next_job_is_served",
            pool_looping_render_times_out_its_pid_is_gone_and_the_next_job_is_served,
        ),
        (
            "pool_kills_a_worker_past_its_memory_cap_and_serves_the_next_job",
            pool_kills_a_worker_past_its_memory_cap_and_serves_the_next_job,
        ),
        (
            "pool_a_table_just_over_300_pages_is_too_many_pages_and_not_killed_for_memory",
            pool_a_table_just_over_300_pages_is_too_many_pages_and_not_killed_for_memory,
        ),
        (
            "pool_the_same_table_under_a_deliberately_low_cap_is_killed_for_memory",
            pool_the_same_table_under_a_deliberately_low_cap_is_killed_for_memory,
        ),
        (
            "pool_replaces_a_worker_that_panics_and_says_nothing_of_the_job",
            pool_replaces_a_worker_that_panics_and_says_nothing_of_the_job,
        ),
        (
            "pool_replaces_a_worker_killed_while_idle",
            pool_replaces_a_worker_killed_while_idle,
        ),
        (
            "pool_caller_a_saturating_gets_busy_while_caller_b_is_served",
            pool_caller_a_saturating_gets_busy_while_caller_b_is_served,
        ),
        (
            "pool_a_dropped_permit_gives_its_place_back",
            pool_a_dropped_permit_gives_its_place_back,
        ),
        (
            "pool_a_cancelled_job_kills_its_worker",
            pool_a_cancelled_job_kills_its_worker,
        ),
        (
            "pool_shutdown_refuses_new_jobs_and_ends_the_workers",
            pool_shutdown_refuses_new_jobs_and_ends_the_workers,
        ),
        (
            "pool_moves_a_large_job_to_the_worker_and_back",
            pool_moves_a_large_job_to_the_worker_and_back,
        ),
        (
            "pool_a_fit_check_is_a_job_with_the_engines_answer",
            pool_a_fit_check_is_a_job_with_the_engines_answer,
        ),
        (
            "pool_a_fit_check_that_loops_is_killed_at_the_deadline",
            pool_a_fit_check_that_loops_is_killed_at_the_deadline,
        ),
        (
            "pool_a_fit_check_that_hogs_memory_is_killed_for_it",
            pool_a_fit_check_that_hogs_memory_is_killed_for_it,
        ),
        (
            "pool_with_every_interactive_slot_busy_a_pdf_is_still_admitted_and_served",
            pool_with_every_interactive_slot_busy_a_pdf_is_still_admitted_and_served,
        ),
        (
            "pool_with_one_worker_nothing_is_reserved",
            pool_with_one_worker_nothing_is_reserved,
        ),
        (
            "worker_ends_itself_when_a_job_outlives_its_hard_deadline",
            worker_ends_itself_when_a_job_outlives_its_hard_deadline,
        ),
        // The real worker.
        (
            "real_worker_refuses_a_test_layout",
            real_worker_refuses_a_test_layout,
        ),
        (
            "real_worker_is_served_by_the_pool",
            real_worker_is_served_by_the_pool,
        ),
        ("real_worker_runs_a_fit_check", real_worker_runs_a_fit_check),
        (
            "real_worker_makes_no_network_call_and_writes_no_file",
            real_worker_makes_no_network_call_and_writes_no_file,
        ),
        (
            "worker_sources_name_no_socket_file_program_or_variable",
            worker_sources_name_no_socket_file_program_or_variable,
        ),
    ]
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures

fn block_on<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(future)
}

fn test_worker() -> WorkerCommand {
    WorkerCommand {
        program: std::env::current_exe().expect("current exe"),
        args: vec!["worker".into()],
    }
}

fn real_worker() -> WorkerCommand {
    WorkerCommand {
        program: env!("CARGO_BIN_EXE_letterhead-api").into(),
        args: vec!["worker".into()],
    }
}

fn config(workers: usize, queue: usize) -> PoolConfig {
    PoolConfig::new(workers, queue, test_worker())
}

const BAND: &str = "22222222-2222-4222-8222-222222222222";

fn band_svg() -> Vec<u8> {
    br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect x="0" y="0" width="6" height="297" fill="#e50339"/></svg>"##.to_vec()
}

fn letterhead() -> LetterheadConfig {
    let mut config = default_config();
    config.variants.default.background = Some(BAND.to_owned());
    config
}

fn assets() -> Assets {
    let mut assets = Assets::new();
    assets.insert(BAND.to_owned(), band_svg());
    // Not used by the letterhead: must not be sent.
    assets.insert(
        "99999999-9999-4999-8999-999999999999".to_owned(),
        vec![7; 64],
    );
    assets
}

fn version(config: LetterheadConfig) -> LetterheadVersion {
    LetterheadVersion {
        number: 3,
        layout_version: 1,
        config,
    }
}

fn request() -> RenderRequest {
    let body = serde_json::json!({
        "contentVersion": 1,
        "entity": "welld_it",
        "language": "it",
        "entityData": { "legalName": "Esempio S.r.l.", "addressLines": ["Via Roma 1", "20100 Milano"] },
        "blocks": [
            { "type": "heading", "level": 1, "text": "Offerta" },
            { "type": "paragraph", "runs": [{ "text": "Testo con #set page(width: 1cm), *a*, _a_, $x^2$, @label e {page}." }] },
            { "type": "pageBreak" },
            { "type": "paragraph", "runs": [{ "text": "Seconda pagina" }] }
        ],
    });
    parse_request(body.to_string().as_bytes()).expect("a valid request")
}

fn job(output: Output) -> Job {
    Job::new(request(), version(letterhead()), assets(), output)
}

fn pid_is_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn wait_until_gone(pid: u32, within: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < within {
        if !pid_is_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    !pid_is_alive(pid)
}

fn pdf_of(output: pool::JobOutput) -> Vec<u8> {
    match output.body {
        Body::Pdf(pdf) => pdf,
        Body::Preview(_) | Body::Fit(_) => panic!("a PDF was asked for"),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Admission

fn sched_a_free_slot_runs_the_job_at_once() {
    use pool::sched::{Admit, Sched};
    let mut sched = Sched::new(vec![1u32, 2], 0, 2);
    assert!(matches!(sched.admit("a"), Admit::Ready(_)));
    assert!(matches!(sched.admit("a"), Admit::Ready(_)));
    // No slot and no queue: turned away, whoever asks.
    assert!(matches!(sched.admit("a"), Admit::Busy));
    assert!(matches!(sched.admit("b"), Admit::Busy));
    sched.release(1);
    assert!(matches!(sched.admit("b"), Admit::Ready(1)));
}

fn sched_bounds_the_queue_and_each_callers_share_of_it() {
    use pool::sched::{Admit, Sched};
    // One worker, four places, two per caller (the defaults of the plan).
    let mut sched = Sched::new(vec![0u32], 4, 2);
    let mut keep = Vec::new();
    let mut take = |sched: &mut Sched<u32>, caller: &str| match sched.admit(caller) {
        Admit::Ready(_) => "ready",
        Admit::Wait { rx, .. } => {
            keep.push(rx);
            "wait"
        }
        Admit::Busy => "busy",
    };
    assert_eq!(take(&mut sched, "a"), "ready"); // runs
    assert_eq!(take(&mut sched, "a"), "wait");
    assert_eq!(take(&mut sched, "a"), "wait");
    assert_eq!(
        take(&mut sched, "a"),
        "busy",
        "caller a holds its two places"
    );
    // The rest of the queue is not a's.
    assert_eq!(take(&mut sched, "b"), "wait");
    assert_eq!(take(&mut sched, "b"), "wait");
    assert_eq!(take(&mut sched, "b"), "busy", "b holds its two");
    assert_eq!(
        take(&mut sched, "c"),
        "busy",
        "the queue of four is full, for anyone"
    );
    assert_eq!(sched.waiting(), 4);
}

fn sched_hands_a_slot_to_the_longest_waiting_job() {
    use pool::sched::{Admit, Sched};
    let mut sched = Sched::new(vec![10u32], 4, 2);
    let Admit::Ready(slot) = sched.admit("a") else {
        panic!("ready")
    };
    let Admit::Wait { rx: mut first, .. } = sched.admit("b") else {
        panic!("wait")
    };
    let Admit::Wait {
        id: second_id,
        rx: mut second,
    } = sched.admit("c")
    else {
        panic!("wait")
    };
    let Admit::Wait { rx: mut third, .. } = sched.admit("d") else {
        panic!("wait")
    };
    // b gives up before a slot comes back: c is next.
    first.close();
    sched.release(slot);
    assert!(first.try_recv().is_err());
    assert_eq!(second.try_recv().ok(), Some(10), "c, the next one waiting");
    assert_eq!(sched.waiting(), 1, "d still waits");
    // A cancelled place is gone, and it is counted out.
    sched.release(11);
    assert_eq!(third.try_recv().ok(), Some(11));
    assert_eq!(sched.waiting(), 0);
    // A job that was handed a slot and is cancelled afterwards changes nothing.
    sched.cancel(second_id);
    assert!(sched.idle().is_empty());
}

fn sched_close_lets_go_of_the_waiting() {
    use pool::sched::{Admit, Sched};
    let mut sched = Sched::new(vec![1u32], 2, 2);
    let Admit::Ready(slot) = sched.admit("a") else {
        panic!("ready")
    };
    let Admit::Wait { mut rx, .. } = sched.admit("b") else {
        panic!("wait")
    };
    assert!(sched.close().is_empty());
    assert!(matches!(
        rx.try_recv(),
        Err(tokio::sync::oneshot::error::TryRecvError::Closed)
    ));
    assert!(matches!(sched.admit("c"), Admit::Busy));
    sched.release(slot);
    assert!(
        sched.idle().is_empty(),
        "a slot that returns after close is dropped"
    );
}

fn sched_keeps_the_last_slot_for_pdfs_and_a_pdf_overtakes_interactive_waiters() {
    use pool::sched::{Admit, Class, Sched};
    // Two slots: interactive jobs may hold one.
    let mut sched = Sched::new(vec![1u32, 2], 4, 4);
    let Admit::Ready(first) = sched.admit_as("a", Class::Interactive) else {
        panic!("the first interactive job runs")
    };
    // The second interactive job finds a free slot and may not take it: it waits.
    let Admit::Wait { rx: mut second, .. } = sched.admit_as("b", Class::Interactive) else {
        panic!("the second interactive job waits")
    };
    assert_eq!(sched.idle().len(), 1, "the slot is still free");
    // A PDF takes it at once.
    let Admit::Ready(pdf_slot) = sched.admit_as("c", Class::Pdf) else {
        panic!("a PDF runs on the reserved slot")
    };
    // A third interactive job waits behind the second.
    let Admit::Wait { rx: mut third, .. } = sched.admit_as("d", Class::Interactive) else {
        panic!("waits")
    };
    // The PDF's slot comes back: the waiting interactive jobs are still over their limit, so it stays idle.
    sched.release_as(pdf_slot, Class::Pdf);
    assert!(second.try_recv().is_err() && third.try_recv().is_err());
    assert_eq!(sched.idle().len(), 1);
    // A PDF that waits (nothing free) is served before interactive jobs that queued earlier.
    let Admit::Ready(again) = sched.admit_as("e", Class::Pdf) else {
        panic!("ready")
    };
    let Admit::Wait {
        rx: mut late_pdf, ..
    } = sched.admit_as("f", Class::Pdf)
    else {
        panic!("waits")
    };
    // The interactive job running finishes: its slot goes to the longest-waiting job that may have it, which is
    // the second interactive (limit is free again), then the third waits for the next one.
    let first_slot = first;
    sched.release_as(first, Class::Interactive);
    assert_eq!(second.try_recv().ok(), Some(first_slot));
    assert!(late_pdf.try_recv().is_err());
    // `again` (a PDF) returns: the PDF that waits has it before the third interactive job, which is over its limit.
    sched.release_as(again, Class::Pdf);
    assert!(third.try_recv().is_err(), "over its limit: not served");
    assert!(late_pdf.try_recv().is_ok(), "the PDF is served first");
}

fn sched_with_one_slot_reserves_nothing() {
    use pool::sched::{Admit, Class, Sched};
    let mut sched = Sched::new(vec![1u32], 1, 1);
    assert!(matches!(
        sched.admit_as("a", Class::Interactive),
        Admit::Ready(_)
    ));
    // And with two slots, two PDFs may take both.
    let mut sched = Sched::new(vec![1u32, 2], 0, 1);
    assert!(matches!(sched.admit_as("a", Class::Pdf), Admit::Ready(_)));
    assert!(matches!(sched.admit_as("a", Class::Pdf), Admit::Ready(_)));
}

fn sched_a_returning_interactive_slot_lets_the_next_interactive_job_in() {
    use pool::sched::{Admit, Class, Sched};
    let mut sched = Sched::new(vec![1u32, 2, 3], 4, 4);
    // Three slots: two for interactive jobs.
    let Admit::Ready(a) = sched.admit_as("a", Class::Interactive) else {
        panic!("ready")
    };
    let Admit::Ready(_b) = sched.admit_as("b", Class::Interactive) else {
        panic!("ready")
    };
    let Admit::Wait { rx: mut c, .. } = sched.admit_as("c", Class::Interactive) else {
        panic!("waits: the last slot is the PDFs'")
    };
    sched.release_as(a, Class::Interactive);
    assert_eq!(c.try_recv().ok(), Some(a), "its slot goes to the waiter");
    // A permit that was never spent also gives its place back: the count does not leak.
    let mut sched = Sched::new(vec![1u32, 2], 1, 1);
    let Admit::Ready(slot) = sched.admit_as("a", Class::Interactive) else {
        panic!("ready")
    };
    sched.release_as(slot, Class::Interactive);
    assert!(matches!(
        sched.admit_as("a", Class::Interactive),
        Admit::Ready(_)
    ));
}

// ---------------------------------------------------------------------------------------------------------------
// The frame and the codec

fn wire_job_content_cannot_be_taken_for_framing() {
    // Parts that look like frames, like lengths, like the magic, and empty ones.
    let mut inner = Vec::new();
    write_frame(&mut inner, &[b"LHW1", &[0, 0, 0, 1]]).expect("inner");
    let huge_length = u64::MAX.to_be_bytes();
    let parts: Vec<Vec<u8>> = vec![
        inner,
        huge_length.to_vec(),
        Vec::new(),
        b"LHW1\0\0\0\x05".to_vec(),
        vec![0u8; 100_000],
        (0..=255u8).collect(),
    ];
    let refs: Vec<&[u8]> = parts.iter().map(Vec::as_slice).collect();
    let mut bytes = Vec::new();
    write_frame(&mut bytes, &refs).expect("write");
    // Two frames back to back: reading the first leaves exactly the second.
    write_frame(&mut bytes, &[b"next"]).expect("write");
    let mut input = bytes.as_slice();
    assert_eq!(read_frame(&mut input).expect("first"), Some(parts));
    assert_eq!(
        read_frame(&mut input).expect("second"),
        Some(vec![b"next".to_vec()])
    );
    assert_eq!(read_frame(&mut input).expect("end"), None);
    // No part at all is a frame too.
    let mut bytes = Vec::new();
    write_frame(&mut bytes, &[]).expect("write");
    assert_eq!(
        read_frame(&mut bytes.as_slice()).expect("empty"),
        Some(vec![])
    );
}

fn wire_refuses_what_is_not_a_frame() {
    fn read(bytes: &[u8]) -> Result<Option<Vec<Vec<u8>>>, FrameError> {
        read_frame(&mut &*bytes)
    }
    assert!(read(b"").expect("eof").is_none());
    assert!(matches!(
        read(b"GET / HTTP/1.1\r\n\r\n"),
        Err(FrameError::Corrupt)
    ));
    // A frame cut short, in the header, in a length, in a part.
    assert!(matches!(read(b"LHW1\0"), Err(FrameError::Io(_))));
    assert!(matches!(
        read(b"LHW1\0\0\0\x01\0\0"),
        Err(FrameError::Io(_))
    ));
    assert!(matches!(
        read(b"LHW1\0\0\0\x01\0\0\0\0\0\0\0\x09abc"),
        Err(FrameError::Io(_))
    ));
    // More parts than a frame may have.
    let mut many = b"LHW1".to_vec();
    many.extend_from_slice(&(wire::MAX_PARTS + 1).to_be_bytes());
    assert!(matches!(read(&many), Err(FrameError::Corrupt)));
    // A part longer than the whole frame may be: refused before any byte of it is read or any memory is taken.
    let mut long = b"LHW1\0\0\0\x01".to_vec();
    long.extend_from_slice(&(wire::MAX_FRAME_BYTES + 1).to_be_bytes());
    assert!(matches!(read(&long), Err(FrameError::Corrupt)));
    // Two parts that together are too many bytes.
    let mut two = b"LHW1\0\0\0\x02".to_vec();
    two.extend_from_slice(&(wire::MAX_FRAME_BYTES - 1).to_be_bytes());
    assert!(
        matches!(read(&two), Err(FrameError::Io(_))),
        "it starts to read, then the stream ends"
    );
}

fn wire_async_matches_sync() {
    block_on(async {
        let (mut a, mut b) = tokio::io::duplex(1024);
        let parts: Vec<Vec<u8>> = vec![b"one".to_vec(), vec![9u8; 50_000], Vec::new()];
        let refs: Vec<&[u8]> = parts.iter().map(Vec::as_slice).collect();
        let writer = async {
            wire::write_frame_async(&mut a, &refs).await.expect("write");
            drop(a);
        };
        let reader = async {
            let first = wire::read_frame_async(&mut b).await.expect("read");
            let end = wire::read_frame_async(&mut b).await.expect("eof");
            (first, end)
        };
        let ((), (first, end)) = tokio::join!(writer, reader);
        assert_eq!(first, Some(parts));
        assert_eq!(end, None);
    });
}

fn job_codec_round_trips_and_sends_only_the_assets_in_use() {
    use pool::job::decode_job;
    let job = job(Output::Preview(PageSelection::Pages(vec![1, 2])));
    let (header, assets) = job.encode().expect("encode");
    assert_eq!(assets.len(), 1, "the unused asset is not sent");
    assert_eq!(assets[0], band_svg().as_slice());
    let mut parts = vec![header.clone()];
    parts.extend(assets.iter().map(|a| a.to_vec()));
    let decoded = decode_job(parts).expect("decode");
    assert_eq!(decoded.request, Some(request()));
    assert_eq!(decoded.version.number, 3);
    assert_eq!(decoded.version.config, letterhead());
    assert_eq!(
        decoded.output,
        Output::Preview(PageSelection::Pages(vec![1, 2]))
    );
    assert_eq!(decoded.assets.len(), 1);

    // A header that does not match the assets that follow, or that is not ours, is refused.
    assert!(
        decode_job(vec![header.clone()]).is_err(),
        "an asset is missing"
    );
    assert!(decode_job(vec![b"{}".to_vec()]).is_err());
    assert!(decode_job(vec![]).is_err());
    let mut value: serde_json::Value = serde_json::from_slice(&header).expect("json");
    value["surprise"] = serde_json::json!(1);
    let extra = serde_json::to_vec(&value).expect("json");
    assert!(
        decode_job(vec![extra, band_svg()]).is_err(),
        "an unknown member"
    );

    // Replies: the shape is checked against the parts.
    assert!(decode_reply(vec![b"nope".to_vec()]).is_err());
    let failed = serde_json::to_vec(&Reply::Failed).expect("json");
    assert_eq!(decode_reply(vec![failed.clone()]), Ok(Answer::Failed));
    assert!(decode_reply(vec![failed, b"extra".to_vec()]).is_err());
}

fn job_codec_carries_a_fit_check_without_a_request_and_refuses_a_document_without_one() {
    use pool::job::decode_job;
    let fit = fit_job(letterhead());
    let (header, assets) = fit.encode().expect("encode");
    let text = String::from_utf8(header.clone()).expect("json");
    assert!(
        !text.contains("\"request\""),
        "a fit check has no document: {text}"
    );
    let mut parts = vec![header];
    parts.extend(assets.iter().map(|a| a.to_vec()));
    let decoded = decode_job(parts).expect("decode");
    assert!(decoded.request.is_none());
    assert_eq!(decoded.output, Output::Fit);
    assert_eq!(decoded.assets.len(), 1);
    // A PDF whose header has no request, and a fit check that carries one, are faults.
    let (header, _) = job(Output::Pdf).encode().expect("encode");
    let mut value: serde_json::Value = serde_json::from_slice(&header).expect("json");
    value.as_object_mut().expect("object").remove("request");
    assert!(decode_job(vec![value.to_string().into_bytes(), band_svg()]).is_err());
    value["request"] = serde_json::to_value(request()).expect("json");
    value["output"] = serde_json::json!({ "kind": "fit" });
    assert!(decode_job(vec![value.to_string().into_bytes(), band_svg()]).is_err());
}

fn rss_readings_parse_and_a_live_process_has_some() {
    use pool::rss::{parse_proc_status, parse_ps, resident_bytes};
    assert_eq!(
        parse_proc_status("Name:\tx\nVmRSS:\t  2048 kB\nThreads:\t1\n"),
        Some(2048 * 1024)
    );
    assert_eq!(parse_proc_status("Name:\tx\n"), None);
    assert_eq!(parse_proc_status("VmRSS:\t12 MB\n"), None);
    assert_eq!(parse_ps("  4096\n"), Some(4096 * 1024));
    assert_eq!(parse_ps(""), None);
    let mine =
        block_on(resident_bytes(std::process::id())).expect("this process has a resident set");
    assert!(mine > 1024 * 1024, "{mine}");
    assert_eq!(
        block_on(resident_bytes(u32::MAX - 1)),
        None,
        "no such process"
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The pool

fn pool_renders_what_the_engine_renders() {
    block_on(async {
        let pool = Pool::start(config(2, 4)).expect("start");
        let direct = render(&request(), &version(letterhead()), &assets()).expect("direct render");

        // The PDF is byte for byte the one of an in-process render (AC-1.4: the worker adds nothing).
        let output = pool.render("crm", job(Output::Pdf)).await.expect("pdf");
        assert_eq!(output.meta.page_count, direct.page_count);
        assert_eq!(output.meta.letterhead_version, 3);
        assert_eq!(output.meta.layout_version, 1);
        assert_eq!(pdf_of(output), direct.pdf().expect("pdf"));

        // The same worker, a second time: nothing carried over changes the bytes.
        let again = pool.render("crm", job(Output::Pdf)).await.expect("pdf");
        assert_eq!(pdf_of(again), direct.pdf().expect("pdf"));

        // The preview: the pages asked for, with their pictures and text.
        let output = pool
            .render("crm", job(Output::Preview(PageSelection::Pages(vec![2]))))
            .await
            .expect("preview");
        let Body::Preview(pages) = output.body else {
            panic!("a preview was asked for")
        };
        let expected = direct
            .preview(&PageSelection::Pages(vec![2]))
            .expect("direct preview");
        assert_eq!(pages, expected);
        assert_eq!(pages.len(), 1);
        assert!(pages[0].text.contains("Seconda pagina"));
    });
}

fn pool_passes_an_engine_refusal_with_code_and_path_only() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        // A layout this binary does not have.
        let mut unknown = version(letterhead());
        unknown.layout_version = 99;
        let job = Job::new(request(), unknown, assets(), Output::Pdf);
        let Err(PoolError::Refused(refusal)) = pool.render("crm", job).await else {
            panic!("a refusal")
        };
        assert_eq!(refusal.code, "unknown_layout");
        assert_eq!(refusal.path, None);
        // A page that the document does not have.
        let job = job_for_page(9);
        let Err(PoolError::Refused(refusal)) = pool.render("crm", job).await else {
            panic!("a refusal")
        };
        assert_eq!(refusal.code, "invalid_pages");
        // The worker that refused is fine and serves the next job.
        assert!(pool.render("crm", job_for_page(1)).await.is_ok());
    });
}

fn job_for_page(page: usize) -> Job {
    job(Output::Preview(PageSelection::Pages(vec![page])))
}

fn pool_worker_has_an_empty_environment() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        let pid = pool.idle_pids()[0];
        let probe = job(Output::Pdf).with_test_layout(TestLayout::Probe);
        let output = pool.render("crm", probe).await.expect("probe");
        let report: serde_json::Value =
            serde_json::from_slice(&pdf_of(output)).expect("the probe's json");
        assert_eq!(
            report["pid"], pid,
            "the probe ran in the worker the pool holds"
        );
        assert_eq!(report["env_vars"], 0, "{report}");
        // The worker ends itself two seconds after the deadline, should its supervisor die.
        assert_eq!(
            report["args"],
            serde_json::json!(["--hard-deadline-ms", "32000"])
        );
    });
}

fn pool_looping_render_times_out_its_pid_is_gone_and_the_next_job_is_served() {
    block_on(async {
        let mut cfg = config(1, 1);
        cfg.deadline = Duration::from_secs(1);
        let pool = Pool::start(cfg).expect("start");
        let before = pool.idle_pids();
        assert_eq!(before.len(), 1);
        let looping = job(Output::Pdf).with_test_layout(TestLayout::Loop);

        let started = Instant::now();
        let result = pool.render("crm", looping).await;
        let took = started.elapsed();
        assert_eq!(result, Err(PoolError::Timeout));
        assert!(
            took >= Duration::from_secs(1) && took < Duration::from_secs(5),
            "the deadline was 1 s: {took:?}"
        );
        // The answer was not given until the process was killed and reaped: its pid is free now.
        assert!(
            !pid_is_alive(before[0]),
            "worker {} still exists after the 504",
            before[0]
        );
        // A fresh worker is in its place, and serves.
        let after = pool.idle_pids();
        assert_eq!(after.len(), 1);
        assert_ne!(after[0], before[0]);
        let served = pool
            .render("crm", job(Output::Pdf))
            .await
            .expect("next job");
        assert!(pdf_of(served).starts_with(b"%PDF"));
    });
}

fn pool_kills_a_worker_past_its_memory_cap_and_serves_the_next_job() {
    block_on(async {
        let mut cfg = config(1, 1);
        cfg.rss_cap_bytes = 400 * 1024 * 1024;
        cfg.rss_poll = Duration::from_millis(25);
        // The deadline is far: it is the memory cap that must end this.
        cfg.deadline = Duration::from_secs(60);
        let pool = Pool::start(cfg).expect("start");
        let before = pool.idle_pids()[0];
        let started = Instant::now();
        let result = pool
            .render(
                "crm",
                job(Output::Pdf).with_test_layout(TestLayout::Hog { mib: 1024 }),
            )
            .await;
        assert_eq!(result, Err(PoolError::MemoryExceeded));
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "killed by the cap, not the deadline: {:?}",
            started.elapsed()
        );
        assert!(!pid_is_alive(before));
        let served = pool
            .render("crm", job(Output::Pdf))
            .await
            .expect("next job");
        assert!(pdf_of(served).starts_with(b"%PDF"));
    });
}

// ---------------------------------------------------------------------------------------------------------------
// The worst accepted request (T41; AC-3.3, AC-3.5, ADR 20261116-renders-run-in-killable-worker-processes...)
//
// The page limit is checked once the whole document is laid out, so a table of more than 300 pages has used all the
// memory it will ever use before it can be refused. Under the old cap (1 GiB) a table a little over the limit was
// killed first and answered 503 `render_memory_exceeded` instead of 422 `too_many_pages`. These two tests are that
// document, once under the default cap (422, the worker untouched) and once under a deliberately low one (killed, 503).
//
// They are off unless `LETTERHEAD_WORST_CASE_TESTS=1`: the document is 4 984 blocks, a debug build of the engine
// takes minutes over it (the service's own 30 s deadline is for an optimised one), and a machine that cannot spare
// 2 GiB for a test should not fail the suite. CI sets the variable; `LETTERHEAD_REQUIRE_DB_TESTS=1` is not what
// turns it on, because these tests need no database.

const WORST_CASE_VAR: &str = "LETTERHEAD_WORST_CASE_TESTS";

fn worst_case_enabled() -> bool {
    let on = std::env::var(WORST_CASE_VAR).as_deref() == Ok("1");
    if !on {
        eprintln!("SKIPPED: set {WORST_CASE_VAR}=1 to run the worst-case table tests");
    }
    on
}

/// Middle cell of the table below, in characters. 163 lays out to exactly 300 pages, the most that is accepted; 164 to
/// 301 or more, the first size that is refused. Both peak near 1.53 GiB in a fresh worker on Linux (VmHWM, optimised build, T46; 1.6 and 1.8 GiB by `ps` on macOS, 1.35 GiB in T41,
/// T41), against 835 MiB for 162 characters: the layout steps up by a line in every row between 162 and 163. A font
/// or layout change moves them, and the tests say so when it does.
const FITS_DETAIL: usize = 163;
const OVER_DETAIL: usize = 164;

/// A table of 1 660 rows x 3 cells (4 984 blocks, the 5 000 allowed less the table's own) whose middle cell is
/// `detail` characters: the document of `perf/worst-case.ts` (same shape, same text) on this file's letterhead.
fn table_job(detail: usize) -> Job {
    let cell =
        |text: String| serde_json::json!([{ "type": "paragraph", "runs": [{ "text": text }] }]);
    let rows: Vec<serde_json::Value> = (0..1660)
        .map(|i| {
            let long = format!(
                "Dettaglio della voce {}: {}",
                i + 1,
                "descrizione dell'attivita svolta ".repeat(8)
            );
            serde_json::json!([
                cell(format!("Voce {}", i + 1)),
                cell(long.chars().take(detail).collect()),
                cell(format!("{}.00", i + 1)),
            ])
        })
        .collect();
    let body = serde_json::json!({
        "contentVersion": 1,
        "entity": "welld_it",
        "language": "it",
        "entityData": { "legalName": "Esempio S.r.l.", "addressLines": ["Via Roma 1", "20100 Milano"] },
        "blocks": [{
            "type": "table",
            "columns": [5, 3, 2],
            "header": [cell("Voce".into()), cell("Dettaglio".into()), cell("Importo".into())],
            "rows": rows,
        }],
    });
    let request = parse_request(body.to_string().as_bytes()).expect("a valid request");
    Job::new(request, version(letterhead()), assets(), Output::Pdf)
}

/// The highest resident set of a process, read from outside every 25 ms until `stop` is called.
struct PeakRss {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    peak: std::sync::Arc<std::sync::atomic::AtomicU64>,
    task: tokio::task::JoinHandle<()>,
}

impl PeakRss {
    fn watch(pid: u32) -> PeakRss {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        let stop = Arc::new(AtomicBool::new(false));
        let peak = Arc::new(AtomicU64::new(0));
        let (flag, highest) = (Arc::clone(&stop), Arc::clone(&peak));
        let task = tokio::spawn(async move {
            while !flag.load(Ordering::Relaxed) {
                if let Some(rss) = pool::rss::resident_bytes(pid).await {
                    highest.fetch_max(rss, Ordering::Relaxed);
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        });
        PeakRss { stop, peak, task }
    }

    /// The peak in MiB.
    async fn stop(self) -> u64 {
        use std::sync::atomic::Ordering;
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.task.await;
        self.peak.load(Ordering::Relaxed) / (1024 * 1024)
    }
}

fn pool_a_table_just_over_300_pages_is_too_many_pages_and_not_killed_for_memory() {
    if !worst_case_enabled() {
        return;
    }
    // A pool of its own for each document: a worker keeps memory it has used (its resident set does not shrink
    // after a job), so the second document of a shared worker would be measured on top of the first.
    let pool_of_one = || {
        let mut cfg = config(1, 1);
        // The default cap is what this test is about: it must leave room above this document.
        assert_eq!(cfg.rss_cap_bytes, 2048 * 1024 * 1024);
        cfg.deadline = Duration::from_secs(900); // a debug engine is slow; the deadline is not under test
        Pool::start(cfg).expect("start")
    };
    block_on(async {
        // The biggest that still fits: the page limit is not what makes the next one fail.
        let pool = pool_of_one();
        let fits = pool
            .render("crm", table_job(FITS_DETAIL))
            .await
            .expect("a table of 300 pages renders");
        assert!(
            (299..=300).contains(&fits.meta.page_count),
            "the layout moved: {} pages",
            fits.meta.page_count
        );
        assert!(pdf_of(fits).starts_with(b"%PDF"));

        // A few characters more in each cell and the document is over the limit: 422, and not a kill.
        let pool = pool_of_one();
        let pid = pool.idle_pids()[0];
        let watch = PeakRss::watch(pid);
        let started = Instant::now();
        let over = pool.render("crm", table_job(OVER_DETAIL)).await;
        let peak = watch.stop().await;
        let refusal = match over {
            Err(PoolError::Refused(refusal)) => refusal,
            other => panic!(
                "a table over 300 pages is refused as too_many_pages, not killed for memory: {:?} after {:?}, \
                 the worker's peak was {peak} MiB of 2048",
                other.map(|_| ()),
                started.elapsed()
            ),
        };
        println!(
            "    over the limit: refused after {:?}; the worker's peak was {peak} MiB of 2048",
            started.elapsed()
        );
        assert_eq!(refusal.code, "too_many_pages");
        assert_eq!((&refusal.path, &refusal.reason), (&None, &None));
        assert_eq!(pool.idle_pids(), vec![pid], "the same worker, never killed");
        // And that worker serves the next job.
        assert!(
            pdf_of(pool.render("crm", job(Output::Pdf)).await.expect("next")).starts_with(b"%PDF")
        );
    });
}

fn pool_the_same_table_under_a_deliberately_low_cap_is_killed_for_memory() {
    if !worst_case_enabled() {
        return;
    }
    block_on(async {
        let mut cfg = config(1, 1);
        // Well under what the table needs (about 1 GiB), above what a worker holds at rest.
        cfg.rss_cap_bytes = 512 * 1024 * 1024;
        cfg.rss_poll = Duration::from_millis(25);
        cfg.deadline = Duration::from_secs(900);
        let pool = Pool::start(cfg).expect("start");
        let before = pool.idle_pids()[0];
        let started = Instant::now();
        let result = pool.render("crm", table_job(OVER_DETAIL)).await;
        assert_eq!(
            result.as_ref().err(),
            Some(&PoolError::MemoryExceeded),
            "the cap is reached before the page check: {result:?}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(600),
            "killed by the cap, not the deadline"
        );
        assert!(!pid_is_alive(before));
        assert!(
            pdf_of(pool.render("crm", job(Output::Pdf)).await.expect("next")).starts_with(b"%PDF")
        );
    });
}

fn pool_replaces_a_worker_that_panics_and_says_nothing_of_the_job() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        let before = pool.idle_pids()[0];
        let error = pool
            .render("crm", job(Output::Pdf).with_test_layout(TestLayout::Panic))
            .await
            .expect_err("a panic is a failure");
        assert_eq!(error, PoolError::WorkerFailed);
        let text = format!("{error} {error:?}");
        assert!(!text.contains("marker-4711"), "{text}");
        assert!(wait_until_gone(before, Duration::from_secs(5)));
        let served = pool
            .render("crm", job(Output::Pdf))
            .await
            .expect("next job");
        assert!(pdf_of(served).starts_with(b"%PDF"));
    });
}

fn pool_replaces_a_worker_killed_while_idle() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        let before = pool.idle_pids()[0];
        let status = Command::new("kill")
            .args(["-9", &before.to_string()])
            .status()
            .expect("kill");
        assert!(status.success());
        // The OOM killer, a crash: the next job is not lost to it. (The dead worker is reaped when the pool next
        // looks at it, so its pid is free after that and not before.)
        let served = pool.render("crm", job(Output::Pdf)).await.expect("served");
        assert!(pdf_of(served).starts_with(b"%PDF"));
        assert_ne!(pool.idle_pids()[0], before);
        assert!(wait_until_gone(before, Duration::from_secs(5)));
    });
}

fn pool_caller_a_saturating_gets_busy_while_caller_b_is_served() {
    block_on(async {
        // One worker, the plan's queue of 4 and share of 2.
        let pool = Pool::start(config(1, 4)).expect("start");
        let hold = || job(Output::Pdf).with_test_layout(TestLayout::Hold { millis: 700 });

        let mut running = Vec::new();
        // Caller a: one runs, two wait.
        for _ in 0..3 {
            let permit = pool.admit("service-a").expect("a has room");
            running.push(tokio::spawn(permit.run(hold())));
        }
        assert_eq!(pool.waiting(), 2);
        // Its fourth is turned away, with the retry hint.
        let busy = pool.admit("service-a").err().expect("a is saturated");
        assert_eq!(
            busy,
            PoolError::Busy {
                retry_after: Duration::from_secs(2)
            }
        );
        // Caller b is not stopped by that: it has a place, and its job is served.
        let permit = pool.admit("service-b").expect("b has room");
        let started = Instant::now();
        let b = tokio::spawn(permit.run(job(Output::Pdf)));
        assert_eq!(pool.waiting(), 3);
        // b too is limited to its own share.
        let _b2 = pool.admit("service-b").expect("b's second place");
        assert!(matches!(
            pool.admit("service-b"),
            Err(PoolError::Busy { .. })
        ));
        drop(_b2);

        let served = b.await.expect("join").expect("b is served");
        assert!(pdf_of(served).starts_with(b"%PDF"));
        // It waited its turn behind a's three jobs, and was not refused.
        assert!(
            started.elapsed() > Duration::from_millis(500),
            "{:?}",
            started.elapsed()
        );
        for handle in running {
            handle
                .await
                .expect("join")
                .expect("a's jobs are served too");
        }
        // Everything is back: a may ask again.
        assert!(pool.admit("service-a").is_ok());
    });
}

fn pool_a_dropped_permit_gives_its_place_back() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        let first = pool.admit("a").expect("runs");
        let second = pool.admit("b").expect("waits");
        assert!(matches!(pool.admit("c"), Err(PoolError::Busy { .. })));
        // The one that waits goes away (a body that failed to parse, a client that left).
        drop(second);
        assert_eq!(pool.waiting(), 0);
        let third = pool.admit("c").expect("the place is free again");
        // The one that holds the worker goes away: the worker is free for the one that waits.
        drop(first);
        let served = third.run(job(Output::Pdf)).await.expect("served");
        assert!(pdf_of(served).starts_with(b"%PDF"));
        assert_eq!(pool.idle_pids().len(), 1, "no worker was lost");
    });
}

fn pool_a_cancelled_job_kills_its_worker() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        let before = pool.idle_pids()[0];
        let permit = pool.admit("a").expect("runs");
        // The caller goes away after a moment: the future is dropped while the worker spins.
        let result = tokio::time::timeout(
            Duration::from_millis(500),
            permit.run(job(Output::Pdf).with_test_layout(TestLayout::Loop)),
        )
        .await;
        assert!(result.is_err(), "it was still running");
        assert!(
            wait_until_gone(before, Duration::from_secs(5)),
            "the work must not go on in the background"
        );
        let served = pool.render("a", job(Output::Pdf)).await.expect("served");
        assert!(pdf_of(served).starts_with(b"%PDF"));
    });
}

fn pool_shutdown_refuses_new_jobs_and_ends_the_workers() {
    block_on(async {
        let pool = Pool::start(config(2, 1)).expect("start");
        let pids = pool.idle_pids();
        assert_eq!(pids.len(), 2);
        pool.shutdown();
        assert!(matches!(pool.admit("a"), Err(PoolError::Busy { .. })));
        for pid in pids {
            assert!(wait_until_gone(pid, Duration::from_secs(5)), "{pid}");
        }
    });
}

fn pool_moves_a_large_job_to_the_worker_and_back() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        // 24 MiB of asset in one job: more than a pipe holds, so writing and reading must go on together.
        let mut assets = Assets::new();
        assets.insert(BAND.to_owned(), vec![0x5a; 24 << 20]);
        let job = Job::new(request(), version(letterhead()), assets, Output::Pdf)
            .with_test_layout(TestLayout::Probe);
        let output = pool.render("crm", job).await.expect("a large job");
        let report: serde_json::Value = serde_json::from_slice(&pdf_of(output)).expect("json");
        assert_eq!(report["env_vars"], 0);
        // And the worker is fine afterwards.
        let served = pool.render("crm", job_for_page(1)).await.expect("served");
        assert!(matches!(served.body, Body::Preview(_)));
    });
}

/// A worker whose supervisor is gone cannot be killed by it: it ends itself.
fn worker_ends_itself_when_a_job_outlives_its_hard_deadline() {
    let mut child = Command::new(std::env::current_exe().expect("exe"))
        .args(["worker", "--hard-deadline-ms", "600"])
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn");
    let mut stdin = child.stdin.take().expect("stdin");
    let looping = job(Output::Pdf).with_test_layout(TestLayout::Loop);
    let (header, assets) = looping.encode().expect("encode");
    let mut parts: Vec<&[u8]> = vec![&header];
    parts.extend(assets);
    write_frame(&mut stdin, &parts).expect("write");
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("wait") {
            break status;
        }
        if started.elapsed() > Duration::from_secs(10) {
            let _ = child.kill();
            panic!("the worker is still looping after 10 s");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(status.code(), Some(124));
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The real binary

fn real_worker_refuses_a_test_layout() {
    // The image's `letterhead-api worker` has no test layouts: a job that asks for one is not a job.
    let looping = job(Output::Pdf).with_test_layout(TestLayout::Loop);
    let (header, assets) = looping.encode().expect("encode");
    assert!(String::from_utf8_lossy(&header).contains("\"test\":\"loop\""));
    let mut child = Command::new(env!("CARGO_BIN_EXE_letterhead-api"))
        .arg("worker")
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn");
    let mut stdin = child.stdin.take().expect("stdin");
    let mut stdout = child.stdout.take().expect("stdout");
    let mut parts: Vec<&[u8]> = vec![&header];
    parts.extend(assets);
    write_frame(&mut stdin, &parts).expect("write");
    let reply = read_frame(&mut stdout).expect("reply").expect("a frame");
    assert_eq!(decode_reply(reply), Ok(Answer::Failed));
    // It is not spinning: it ends.
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("wait") {
            break status;
        }
        assert!(started.elapsed() < Duration::from_secs(10), "it spins");
        std::thread::sleep(Duration::from_millis(20));
    };
    assert!(!status.success());
}

fn real_worker_is_served_by_the_pool() {
    block_on(async {
        let pool = Pool::start(PoolConfig::new(1, 1, real_worker())).expect("start");
        let direct = render(&request(), &version(letterhead()), &assets()).expect("direct");
        let output = pool.render("crm", job(Output::Pdf)).await.expect("pdf");
        assert_eq!(pdf_of(output), direct.pdf().expect("pdf"));
    });
}

fn fit_job(config: LetterheadConfig) -> Job {
    Job::fit(1, config, assets())
}

/// A configuration whose footer cannot fit a 10 mm margin.
fn tight_letterhead() -> LetterheadConfig {
    let mut value = serde_json::to_value(letterhead()).expect("json");
    value["margins"]["bottom"] = serde_json::json!(10);
    serde_json::from_value(value).expect("a configuration")
}

fn problems_of(output: pool::JobOutput) -> Vec<serde_json::Value> {
    match output.body {
        Body::Fit(problems) => problems,
        _ => panic!("a fit check was asked for"),
    }
}

fn pool_a_fit_check_is_a_job_with_the_engines_answer() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        let layout = letterhead_engine::layout::layout(1).expect("layout 1");
        for config in [letterhead(), tight_letterhead()] {
            let direct =
                letterhead_engine::layout::check_fit(layout, &config, &assets()).expect("direct");
            let direct: Vec<serde_json::Value> = direct
                .iter()
                .map(|problem| serde_json::to_value(problem).expect("json"))
                .collect();
            let done = pool
                .render("person:x", fit_job(config))
                .await
                .expect("a fit check is served");
            assert_eq!(problems_of(done), direct);
        }
        // The tight one really is refused: the test is not comparing two empty lists.
        let refused = pool
            .render("person:x", fit_job(tight_letterhead()))
            .await
            .expect("served");
        let refused = problems_of(refused);
        assert!(
            !refused.is_empty(),
            "a 10 mm bottom margin cannot hold the footer"
        );
        assert_eq!(refused[0]["reason"], "footer_overflow");
        // The layout the job names is the layout the worker uses: one that is not in this binary is a refusal.
        let unknown = Job::fit(999, letterhead(), assets());
        assert!(matches!(
            pool.render("person:x", unknown).await,
            Err(PoolError::Refused(_))
        ));
    });
}

fn pool_a_fit_check_that_loops_is_killed_at_the_deadline() {
    block_on(async {
        let mut cfg = config(1, 1);
        cfg.deadline = Duration::from_secs(1);
        let pool = Pool::start(cfg).expect("start");
        let before = pool.idle_pids();
        let started = Instant::now();
        let result = pool
            .render(
                "person:x",
                fit_job(letterhead()).with_test_layout(TestLayout::Loop),
            )
            .await;
        let took = started.elapsed();
        assert_eq!(result, Err(PoolError::Timeout));
        assert!(
            took >= Duration::from_secs(1) && took < Duration::from_secs(5),
            "the deadline was 1 s: {took:?}"
        );
        assert!(!pid_is_alive(before[0]), "the worker is gone");
        let after = pool.idle_pids();
        assert_eq!(after.len(), 1);
        assert_ne!(after[0], before[0]);
        // The slot is served again: by a fit check and by a PDF.
        let done = pool
            .render("person:x", fit_job(letterhead()))
            .await
            .expect("served");
        assert!(problems_of(done).is_empty());
        let served = pool.render("crm", job(Output::Pdf)).await.expect("pdf");
        assert!(pdf_of(served).starts_with(b"%PDF"));
    });
}

fn pool_a_fit_check_that_hogs_memory_is_killed_for_it() {
    block_on(async {
        let mut cfg = config(1, 1);
        cfg.rss_cap_bytes = 400 * 1024 * 1024;
        cfg.rss_poll = Duration::from_millis(20);
        let pool = Pool::start(cfg).expect("start");
        let result = pool
            .render(
                "person:x",
                fit_job(letterhead()).with_test_layout(TestLayout::Hog { mib: 1500 }),
            )
            .await;
        assert_eq!(result, Err(PoolError::MemoryExceeded));
    });
}

fn pool_with_every_interactive_slot_busy_a_pdf_is_still_admitted_and_served() {
    block_on(async {
        // Two workers: previews and fit checks may hold one.
        let pool = Pool::start(config(2, 4)).expect("start");
        let hold = || fit_job(letterhead()).with_test_layout(TestLayout::Hold { millis: 1500 });
        let first = pool.admit_interactive("person:a").expect("runs");
        let running = tokio::spawn(first.run(hold()));
        // The other interactive jobs find a worker free and are still made to wait.
        let second = pool.admit_interactive("person:b").expect("a place");
        assert_eq!(pool.waiting(), 1, "the second interactive job waits");
        assert_eq!(pool.idle_pids().len(), 1, "the reserved worker is idle");
        let third = pool.admit_interactive("person:c").expect("a place");
        assert_eq!(pool.waiting(), 2);
        // A PDF is admitted at once, on the reserved worker, and is served while the others wait.
        let permit = pool.admit("system:crm-api").expect("a PDF is admitted");
        assert_eq!(pool.waiting(), 2, "it did not queue");
        let started = Instant::now();
        let served = permit.run(job(Output::Pdf)).await.expect("served");
        assert!(pdf_of(served).starts_with(b"%PDF"));
        assert!(
            started.elapsed() < Duration::from_millis(1400),
            "the PDF did not wait for the interactive job: {:?}",
            started.elapsed()
        );
        // The interactive jobs are served in their turn.
        let done = second.run(fit_job(letterhead())).await.expect("served");
        assert!(problems_of(done).is_empty());
        let done = third.run(fit_job(letterhead())).await.expect("served");
        assert!(problems_of(done).is_empty());
        assert!(problems_of(running.await.expect("join").expect("served")).is_empty());
    });
}

fn pool_with_one_worker_nothing_is_reserved() {
    block_on(async {
        let pool = Pool::start(config(1, 1)).expect("start");
        // The one worker may be an interactive job's.
        let permit = pool.admit_interactive("person:a").expect("runs");
        assert_eq!(pool.idle_pids().len(), 0);
        let done = permit.run(fit_job(letterhead())).await.expect("served");
        assert!(problems_of(done).is_empty());
    });
}

fn real_worker_runs_a_fit_check() {
    block_on(async {
        let pool = Pool::start(PoolConfig::new(1, 1, real_worker())).expect("start");
        let done = pool
            .render("person:x", fit_job(tight_letterhead()))
            .await
            .expect("fit");
        assert!(!problems_of(done).is_empty());
        let done = pool
            .render("person:x", fit_job(letterhead()))
            .await
            .expect("fit");
        assert!(problems_of(done).is_empty());
    });
}

const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

/// What the sandbox does to a process that tries a network call or a file write: it is killed (SIGKILL). The
/// profile allows everything else, so a worker that renders a PDF and a preview under it, and then ends by itself
/// when its stdin closes, has made no network call and written no file. Under it the worker does everything it
/// does in service: reads two jobs, renders both outputs, evicts, answers.
///
/// Two device files are let through because every macOS process opens them for writing before its own code runs
/// (the dynamic loader's `/dev/dtracehelper`, and `/dev/null`); neither is a file on a disk. A write anywhere else
/// kills the process, as the `touch` below shows.
const SANDBOX_PROFILE: &str = "(version 1)(allow default)\
    (deny network* (with send-signal SIGKILL))\
    (deny file-write* (with send-signal SIGKILL))\
    (allow file-write* (literal \"/dev/null\") (literal \"/dev/dtracehelper\"))";

fn real_worker_makes_no_network_call_and_writes_no_file() {
    let worker = env!("CARGO_BIN_EXE_letterhead-api");
    if cfg!(target_os = "macos") && std::path::Path::new(SANDBOX_EXEC).exists() {
        // First show that the profile does what it is trusted to do: a process that writes a file is killed.
        let probe = Command::new(SANDBOX_EXEC)
            .args([
                "-p",
                SANDBOX_PROFILE,
                "/usr/bin/touch",
                "/tmp/lh-pool-sandbox-probe",
            ])
            .stderr(Stdio::null())
            .status()
            .expect("sandbox-exec");
        assert!(!probe.success(), "the sandbox must stop a file write");
        let probe = Command::new(SANDBOX_EXEC)
            .args([
                "-p",
                SANDBOX_PROFILE,
                "/usr/bin/curl",
                "-s",
                "-m",
                "2",
                "http://127.0.0.1:9",
            ])
            .stderr(Stdio::null())
            .status()
            .expect("sandbox-exec");
        assert_eq!(
            std::os::unix::process::ExitStatusExt::signal(&probe),
            Some(9),
            "the sandbox must kill a process that opens a socket"
        );
        run_worker_under(Command::new(SANDBOX_EXEC).args([
            "-p",
            SANDBOX_PROFILE,
            worker,
            "worker",
        ]));
        println!("    (checked with sandbox-exec: SIGKILL on any network or file-write operation)");
    } else if tool_exists("strace") {
        let trace = std::env::temp_dir().join(format!("lh-pool-strace-{}", std::process::id()));
        run_worker_under(Command::new("strace").args([
            "-f",
            "-qq",
            "-e",
            "trace=network,file",
            "-o",
            &trace.to_string_lossy(),
            worker,
            "worker",
        ]));
        let log = std::fs::read_to_string(&trace).expect("strace log");
        let _ = std::fs::remove_file(&trace);
        let network: Vec<&str> = log
            .lines()
            .filter(|l| {
                [
                    "socket(", "connect(", "bind(", "listen(", "accept", "sendto(", "sendmsg(",
                ]
                .iter()
                .any(|call| l.contains(call))
            })
            .collect();
        assert!(network.is_empty(), "network syscalls: {network:?}");
        let writes: Vec<&str> = log
            .lines()
            .filter(|l| l.contains("O_WRONLY") || l.contains("O_RDWR") || l.contains("O_CREAT"))
            .filter(|l| !l.contains("/dev/null"))
            .collect();
        assert!(writes.is_empty(), "files opened for writing: {writes:?}");
        println!("    (checked with strace -f -e trace=network,file)");
    } else if cfg!(target_os = "linux") {
        // Less than a trace: after serving a job, the worker holds no socket (its descriptors are the two pipes
        // and /dev/null). A call that opened and closed one in between would not show.
        let mut child = Command::new(worker)
            .arg("worker")
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn");
        let mut stdin = child.stdin.take().expect("stdin");
        let mut stdout = child.stdout.take().expect("stdout");
        let job = job(Output::Pdf);
        let (header, assets) = job.encode().expect("encode");
        let mut parts: Vec<&[u8]> = vec![&header];
        parts.extend(assets);
        write_frame(&mut stdin, &parts).expect("write");
        read_frame(&mut stdout).expect("reply").expect("a frame");
        let links: Vec<String> = std::fs::read_dir(format!("/proc/{}/fd", child.id()))
            .expect("fds")
            .filter_map(|e| std::fs::read_link(e.ok()?.path()).ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        drop(stdin);
        let _ = child.wait();
        assert!(links.iter().all(|l| !l.starts_with("socket:")), "{links:?}");
        println!(
            "    (neither sandbox-exec nor strace: checked only that no socket descriptor is held)"
        );
    } else {
        println!("    SKIPPED: neither sandbox-exec (macOS) nor strace (Linux) is available here");
    }
}

fn tool_exists(name: &str) -> bool {
    Command::new(name)
        .arg("-V")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Runs `command` as a worker with an empty environment, gives it a PDF job and a preview job, closes its stdin,
/// and asserts both answers and a clean exit.
fn run_worker_under(command: &mut Command) {
    let mut child = command
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn");
    let mut stdin = child.stdin.take().expect("stdin");
    let mut stdout = child.stdout.take().expect("stdout");

    for output in [Output::Pdf, Output::Preview(PageSelection::All)] {
        let job = job(output);
        let (header, assets) = job.encode().expect("encode");
        let mut parts: Vec<&[u8]> = vec![&header];
        parts.extend(assets);
        write_frame(&mut stdin, &parts).expect("write");
        let reply = read_frame(&mut stdout).expect("reply").expect("a frame");
        let Ok(Answer::Done(done)) = decode_reply(reply) else {
            panic!("the worker did not render under the sandbox")
        };
        match done.body {
            Body::Pdf(pdf) => assert!(pdf.starts_with(b"%PDF")),
            Body::Preview(pages) => assert_eq!(pages.len(), 2),
            Body::Fit(_) => panic!("a document was asked for"),
        }
    }
    drop(stdin);
    let status = child.wait().expect("wait");
    assert!(status.success(), "the worker ends by itself: {status:?}");
}

fn worker_sources_name_no_socket_file_program_or_variable() {
    // A tripwire, not a proof: the worker's own code and the frame and job code it shares. (The test layouts,
    // which read the environment to report it, sit in `testing.rs` and are not in the image.)
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let forbidden: Vec<String> = [
        ("std::", "net"),
        ("tokio::", "net"),
        ("Tcp", "Stream"),
        ("Tcp", "Listener"),
        ("Udp", "Socket"),
        ("Unix", "Stream"),
        ("Unix", "Listener"),
        ("std::", "fs"),
        ("tokio::", "fs"),
        ("File", "::"),
        ("Open", "Options"),
        ("Com", "mand"),
        ("env::", "var"),
        ("reqw", "est"),
        ("hy", "per"),
        ("sq", "lx"),
        ("aws", "_"),
    ]
    .iter()
    .map(|(a, b)| format!("{a}{b}"))
    .collect();
    for file in ["worker.rs", "pool/wire.rs", "pool/job.rs"] {
        let source = std::fs::read_to_string(root.join(file)).expect("source");
        // Comments may name what the code does not do.
        let code: String = source
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for pattern in &forbidden {
            assert!(!code.contains(pattern), "{file} uses `{pattern}`");
        }
    }
}
