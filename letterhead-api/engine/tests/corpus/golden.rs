//! The golden record of every fixture, per layout (AC-1.4, AC-4.5; ADR 20261116-a-letterhead-version-pins-its-
//! layout-and-old-layouts-stay-compiled-in).
//!
//! Each fixture has, per layout, a record in `tests/golden/layout-<n>/<fixture>.json`: the page count, the text of
//! each page, and every line's baseline and x position. Any difference fails the build, and says which line of
//! which page moved and by how much.
//!
//! Re-recording is explicit and never automatic. Set `LETTERHEAD_GOLDEN_RECORD`:
//!
//! - `new`  writes the records that do not exist yet (a new fixture, a new layout) and checks the others;
//! - `all`  also overwrites the records that differ. Do this only to fix a defect of a layout, and say so in the
//!   commit: it changes how every letterhead version saved with that layout lays out, and the owner must be told
//!   (ADR, "Adding a layout"). A changed look is a NEW layout, not a re-recording.
//!
//! Any other value, and any use of the variable when `CI` is set, fails.

use std::fs;

use letterhead_engine::layout::CURRENT_LAYOUT;

use crate::common::*;

const RECORD_VAR: &str = "LETTERHEAD_GOLDEN_RECORD";

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Mode {
    Check,
    RecordNew,
    RecordAll,
}

fn mode() -> Result<Mode, String> {
    match std::env::var(RECORD_VAR) {
        Err(_) => Ok(Mode::Check),
        Ok(value) if value.is_empty() => Ok(Mode::Check),
        Ok(value) if std::env::var("CI").is_ok_and(|ci| !ci.is_empty()) => Err(format!(
            "{RECORD_VAR}={value} is set in CI: goldens are recorded on a developer's machine and reviewed, never by CI"
        )),
        Ok(value) if value == "new" => Ok(Mode::RecordNew),
        Ok(value) if value == "all" => Ok(Mode::RecordAll),
        Ok(value) => Err(format!(
            "{RECORD_VAR}={value}: the values are `new` (write missing records) and `all` (overwrite changed ones too)"
        )),
    }
}

/// Check one fixture against its golden, or record it. `Err` holds what to tell the developer.
fn check(layout: u32, name: &str, actual: &Record, mode: Mode) -> Result<(), String> {
    let path = golden_path(layout, name);
    let write = |reason: &str| -> Result<(), String> {
        fs::create_dir_all(path.parent().expect("parent")).map_err(|e| e.to_string())?;
        fs::write(&path, format_record(actual))
            .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
        eprintln!("GOLDEN RECORDED ({reason}): {}", path.display());
        Ok(())
    };
    if !path.exists() {
        return if mode == Mode::Check {
            Err(format!(
                "no golden for fixture {name} on layout {layout} ({}). Record it on purpose: {RECORD_VAR}=new cargo test -p letterhead-engine --test corpus golden::",
                path.display()
            ))
        } else {
            write("new")
        };
    }
    let golden = read_record(&path)?;
    let diffs = differences(&golden, actual);
    if diffs.is_empty() {
        return Ok(());
    }
    if mode == Mode::RecordAll {
        eprintln!(
            "WARNING: layout {layout} of fixture {name} now lays out differently ({} differences). Every letterhead version saved with layout {layout} will lay out like this: tell the owner (ADR, Adding a layout).",
            diffs.len()
        );
        return write("overwritten");
    }
    let shown = diffs
        .iter()
        .take(25)
        .map(|d| format!("      {d}"))
        .collect::<Vec<_>>()
        .join("\n");
    let more = if diffs.len() > 25 {
        format!("\n      ... and {} more", diffs.len() - 25)
    } else {
        String::new()
    };
    Err(format!(
        "{} differences from {}\n{shown}{more}",
        diffs.len(),
        path.display()
    ))
}

#[test]
fn every_layout_in_the_binary_has_a_golden_for_every_fixture_and_is_checked() {
    let mode = mode().unwrap_or_else(|e| panic!("{e}"));
    let mut failures = Vec::new();
    let mut checked = 0;
    for layout in 1..=CURRENT_LAYOUT {
        assert!(
            letterhead_engine::layout::layout(layout).is_some(),
            "layout {layout} is numbered below the current one and must stay compiled in (ADR)"
        );
        for fixture in fixtures() {
            let actual = record_of(layout, &fixture.name, &rendered(layout, fixture));
            checked += 1;
            if let Err(why) = check(layout, &fixture.name, &actual, mode) {
                failures.push(format!(
                    "  layout {layout}, fixture {} ({}): {why}",
                    fixture.name, fixture.description
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {checked} goldens differ:\n{}\n\nIf a change was intended, it is a new layout (ADR 20261116): add `layouts/<n>/` and record its corpus. Only to fix a defect of an existing layout: {RECORD_VAR}=all.",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn a_golden_without_a_fixture_is_an_error() {
    let names: Vec<&str> = fixtures().iter().map(|f| f.name.as_str()).collect();
    for layout in 1..=CURRENT_LAYOUT {
        for (golden, path) in golden_names(layout) {
            assert!(
                names.contains(&golden.as_str()),
                "{} has no fixture: delete the golden, or restore the fixture (a layout's goldens are never dropped silently)",
                path.display()
            );
        }
    }
}

#[test]
fn recording_is_never_on_in_ci() {
    if let Err(why) = mode() {
        panic!("{why}");
    }
}

/// AC-1.4, over the corpus: the same request twice gives the same page count, the same text on each page, the
/// same position of every line (to the last bit, not to the golden's epsilon) and the same bytes of PDF.
#[test]
fn ac_1_4_a_second_render_of_every_fixture_is_the_same_document() {
    for layout in 1..=CURRENT_LAYOUT {
        for fixture in fixtures() {
            let first = rendered(layout, fixture);
            let second = render_fresh(layout, fixture).map(std::sync::Arc::new);
            match (first, second) {
                (Ok(a), Ok(b)) => {
                    assert_eq!(a.page_count, b.page_count, "{}", fixture.name);
                    assert_eq!(a.page_texts(), b.page_texts(), "{}", fixture.name);
                    for (n, (pa, pb)) in a
                        .document()
                        .pages()
                        .iter()
                        .zip(b.document().pages())
                        .enumerate()
                    {
                        assert_eq!(
                            letterhead_engine::layout::inspect::text_runs(pa),
                            letterhead_engine::layout::inspect::text_runs(pb),
                            "{} page {}: a run moved between two renders",
                            fixture.name,
                            n + 1
                        );
                    }
                    assert!(
                        a.pdf().expect("pdf") == b.pdf().expect("pdf"),
                        "{}: two renders gave different PDF bytes",
                        fixture.name
                    );
                }
                (Err(a), Err(b)) => assert_eq!(a, b, "{}", fixture.name),
                _ => panic!(
                    "{}: one render succeeded and the other did not",
                    fixture.name
                ),
            }
        }
    }
}
