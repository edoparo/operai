//! The test layouts of the worker (see [`TestLayout`]). Compiled into the pool's test binary and into a build with
//! the `test-slow` feature; the image has neither.

use std::time::Duration;

use super::job::{Meta, Reply, TestLayout};

/// Runs a test layout. `None` means: go on and render the job for real (after a delay, say).
pub fn run(layout: &TestLayout) -> Option<(Reply, Vec<Vec<u8>>)> {
    match layout {
        TestLayout::Loop => loop {
            std::hint::black_box(());
        },
        TestLayout::Hold { millis } => {
            std::thread::sleep(Duration::from_millis(*millis));
            None
        }
        TestLayout::Hog { mib } => {
            const CHUNK_MIB: usize = 16;
            let mut held: Vec<Vec<u8>> = Vec::new();
            for _ in 0..(*mib / CHUNK_MIB).max(1) {
                // Written, not just reserved: the resident set grows only with pages that were touched.
                held.push(vec![1u8; CHUNK_MIB << 20]);
                std::thread::sleep(Duration::from_millis(5));
            }
            std::hint::black_box(&held);
            std::thread::sleep(Duration::from_secs(120));
            None
        }
        TestLayout::Panic => panic!("marker-4711 must not reach a log"),
        TestLayout::Probe => {
            let probe = serde_json::json!({
                "pid": std::process::id(),
                "env_vars": std::env::vars_os().count(),
                "args": std::env::args().skip(2).collect::<Vec<_>>(),
            });
            let meta = Meta {
                letterhead_version: 0,
                layout_version: 0,
                page_count: 0,
                missing_placeholders: Vec::new(),
                unprintable_characters: 0,
            };
            Some((Reply::Pdf { meta }, vec![probe.to_string().into_bytes()]))
        }
    }
}
