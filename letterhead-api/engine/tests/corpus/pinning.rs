//! A layout is pinned (AC-4.5, AC-1.8; ADR 20261116-a-letterhead-version-pins-its-layout-and-old-layouts-stay-
//! compiled-in): adding a layout, or changing what the next layout does, never moves a line of an existing one.
//!
//! Two tests guard it from two sides:
//!
//! - **a second layout beside the first.** Layout 2 is a copy of layout 1's template with one value changed
//!   (the body's line pitch), compiled in this process next to layout 1. The corpus is rendered on layout 1,
//!   on layout 2, and on layout 1 again, in one process, and layout 1's record is the golden each time. This is
//!   what "adding a layout" does to the process: a second template, a second `Shared`, the same fonts, the same
//!   interned file names (`/main.typ`, `/data.json`) and the same memoisation cache.
//! - **a lock on the template itself.** A golden corpus only sees what its fixtures draw: a change to a branch
//!   that no fixture reaches would pass it. `layout-<n>/layout.lock` holds the template's SHA-256 and the Typst
//!   version, so that *any* edit of an existing layout's template is a visible change of a tracked file, in the
//!   same commit as the goldens (the ADR's rule for fixing a defect of a layout).

use std::sync::OnceLock;

use letterhead_engine::layout::{
    CURRENT_LAYOUT, LAYOUT_1_FONTS, Layout, compile, layout as layout_of,
};
use letterhead_engine::output::page_text;
use letterhead_engine::render::{LetterheadVersion, RenderError, render};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::common::*;

/// The fixtures laid out in the layout-2 test: enough to draw every block type, both languages' frames, the
/// three variants, a background, a long table. The whole corpus is checked on layout 1 by the golden test.
const SAMPLE: [&str; 5] = ["offer-it", "offer-en", "every-block", "one-page", "inject"];

/// A layout 2 that is not layout 1: the same template with more space between blocks and the text's top edge moved, and the same fonts.
fn layout_two() -> &'static Layout {
    static TWO: OnceLock<Layout> = OnceLock::new();
    TWO.get_or_init(|| {
        let one = layout_of(1).expect("layout 1").template();
        assert_eq!(
            one.matches("#set block(spacing: 0.9em)").count(),
            1,
            "the template no longer sets the block spacing so: update the dummy layout"
        );
        assert_eq!(
            one.matches("hyphenate: false,\n  top-edge: 0.8em,").count(),
            1,
            "the template no longer sets the text's top edge so: update the dummy layout"
        );
        let looser = one
            .replace("#set block(spacing: 0.9em)", "#set block(spacing: 1.4em)")
            .replace(
                "hyphenate: false,\n  top-edge: 0.8em,",
                "hyphenate: false,\n  top-edge: 0.7em,",
            );
        Layout::new(
            2,
            "0.15.1",
            Box::leak(looser.into_boxed_str()),
            &LAYOUT_1_FONTS,
        )
    })
}

fn record_with(layout: &Layout, name: &str) -> Record {
    let fixture = fixture(name);
    let config = letterhead(&fixture.letterhead);
    let compiled = compile(layout, &config, assets(), &fixture.request)
        .unwrap_or_else(|e| panic!("{name} compiles on layout {}: {}", layout.version, e.code()));
    let pages = compiled.document.pages();
    let texts = pages.iter().map(page_text).collect();
    record_of_pages(
        layout.version,
        name,
        pages,
        texts,
        compiled
            .missing_placeholders
            .iter()
            .map(|s| (*s).to_owned())
            .collect(),
    )
}

fn golden_of_layout_1(name: &str) -> Record {
    read_record(&golden_path(1, name)).unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn ac_4_5_adding_a_layout_2_leaves_the_layout_1_goldens_unchanged() {
    let one = layout_of(1).expect("layout 1");
    let two = layout_two();

    // Before: layout 1 is its goldens.
    for name in SAMPLE {
        let diffs = differences(&golden_of_layout_1(name), &record_with(one, name));
        assert!(
            diffs.is_empty(),
            "{name} on layout 1 before layout 2 exists: {} differences, the first: {:?}",
            diffs.len(),
            &diffs[..diffs.len().min(3)]
        );
    }

    // Layout 2 lays the same requests out differently: that is what a new layout is for, and it is what makes
    // this test mean something (a dummy layout that changed nothing would prove nothing).
    let mut unmoved = Vec::new();
    for name in SAMPLE {
        let on_two = record_with(two, name);
        assert_eq!(on_two.layout, 2);
        if differences(
            &golden_of_layout_1(name),
            &Record {
                layout: 1,
                ..on_two
            },
        )
        .is_empty()
        {
            unmoved.push(name);
        }
    }
    assert!(
        unmoved.is_empty(),
        "these sampled fixtures lay out the same on the dummy layout 2, which proves nothing: {unmoved:?}"
    );

    // After: layout 1 is still its goldens, freshly compiled in a process that has laid out layout 2.
    for name in SAMPLE {
        let diffs = differences(&golden_of_layout_1(name), &record_with(one, name));
        assert!(
            diffs.is_empty(),
            "{name} on layout 1 after layout 2 was laid out: {} differences, the first: {:?}",
            diffs.len(),
            &diffs[..diffs.len().min(3)]
        );
    }
}

#[test]
fn a_version_of_a_layout_the_binary_lacks_is_refused_and_never_rendered_with_another() {
    let fixture = fixture("one-page");
    for number in [0, CURRENT_LAYOUT + 1, 2, u32::MAX] {
        assert!(
            layout_of(number).is_none(),
            "layout {number} is not in this binary"
        );
        let version = LetterheadVersion {
            number: 1,
            layout_version: number,
            config: letterhead(&fixture.letterhead),
        };
        let refused: Result<_, RenderError> = render(&fixture.request, &version, assets());
        let error = refused
            .err()
            .unwrap_or_else(|| panic!("layout {number} must be refused"));
        assert_eq!(error.code(), "unknown_layout");
    }
}

/// `layout-<n>/layout.lock`.
fn lock_of(layout: &Layout) -> serde_json::Value {
    json!({
        "layout": layout.version,
        "typst": layout.typst,
        "templateSha256": hex(&Sha256::digest(layout.template().as_bytes())),
        "templateBytes": layout.template().len(),
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn the_template_and_typst_version_of_every_layout_are_locked_beside_its_goldens() {
    for number in 1..=CURRENT_LAYOUT {
        let layout = layout_of(number).expect("a layout below the current one stays compiled in");
        let path = data_dir()
            .join(format!("layout-{number}"))
            .join("layout.lock");
        let actual = lock_of(layout);
        let text = format!("{}\n", serde_json::to_string_pretty(&actual).expect("json"));
        let record = std::env::var("LETTERHEAD_GOLDEN_RECORD").unwrap_or_default();
        match std::fs::read_to_string(&path) {
            Ok(locked) if locked == text => {}
            Ok(_) if record == "all" => {
                std::fs::write(&path, &text).expect("write the lock");
                eprintln!(
                    "WARNING: layout {number}'s template changed and its lock was overwritten: tell the owner (ADR, Adding a layout)."
                );
            }
            Ok(locked) => panic!(
                "layout {number}'s template or Typst version changed since {} was written.\n  locked: {}\n  now:    {}\nAn existing layout is never edited except to fix a defect, with its goldens and this lock re-recorded in the same commit (LETTERHEAD_GOLDEN_RECORD=all) and the owner told (ADR 20261116). A changed look is a new layout.",
                path.display(),
                locked.trim().replace('\n', " "),
                text.trim().replace('\n', " ")
            ),
            Err(_) if record == "new" || record == "all" => {
                std::fs::write(&path, &text).expect("write the lock");
                eprintln!("GOLDEN RECORDED (lock): {}", path.display());
            }
            Err(_) => panic!(
                "{} is missing: record it on purpose with LETTERHEAD_GOLDEN_RECORD=new",
                path.display()
            ),
        }
    }
}
