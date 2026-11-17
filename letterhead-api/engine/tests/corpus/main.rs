//! The engine's corpus tests (task T9, specs/20261116-letterhead-service): one test binary, so that the corpus is
//! loaded and rendered once whatever the number of tests that read it.
//!
//! ```text
//! cargo test -p letterhead-engine --test corpus                  everything below
//! cargo test -p letterhead-engine --test corpus golden::         the golden record of every fixture
//! cargo test -p letterhead-engine --test corpus pinning::        a layout 2 leaves layout 1 alone (AC-4.5)
//! cargo test -p letterhead-engine --test corpus rules::          the ACs read off the corpus (AC-1.5, 1.6, 5.x, 7.x)
//! cargo test -p letterhead-engine --test corpus injection::      property and fuzz tests of injection (AC-2.1)
//! cargo test -p letterhead-engine --test corpus conformance::    the pdfium conformance runner (AC-1.3)
//! ```
//!
//! What the corpus is, how to re-record it and how the conformance runner finds pdfium: `tests/golden/README.md`.

mod common;
mod conformance;
mod golden;
mod injection;
mod pinning;
mod rules;
