//! The text of a page, in reading order (AC-1.2, AC-1.3).
//!
//! Reading order is the order in which the page's frame holds its text, which is the order the PDF's content
//! stream holds it and so the order any extractor reads it in: the header, the body block by block (a table
//! cell by cell, each cell's lines one after the other) and the footer. Sorting by position instead would
//! interleave the lines of two cells that sit side by side, and would no longer be the PDF's text (A5).
//!
//! Runs that follow each other on one baseline are one line; a run that is a word's width away from the one
//! before it is separated from it by a space. A new baseline, or a step back to the left, is a new line,
//! written `\n`. Nothing else is added to the text and nothing is dropped: a long word broken at the margin is
//! its pieces on consecutive lines, and the page's number is a piece of the footer's text like any other. What
//! may differ from an extractor's text is whitespace only, which AC-1.3 normalises.

use typst_layout::Page;

use crate::layout::inspect;

/// Two runs are on one line when their baselines are less than this many pt apart.
const SAME_LINE_PT: f64 = 2.0;
/// A space is added between two runs of a line when the gap between them is more than this share of the
/// size of the second one, and neither has a space at the join.
const WORD_GAP_EM: f64 = 0.15;

pub fn page_text(page: &Page) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut last: Option<(f64, f64)> = None; // the baseline and the right end of the previous run
    for run in inspect::text_runs(page) {
        let continues = last.is_some_and(|(y, end)| {
            (run.y - y).abs() < SAME_LINE_PT && run.x >= end - WORD_GAP_EM * run.size
        });
        if continues {
            let line = lines.last_mut().expect("a line is open");
            let gap = run.x - last.map_or(run.x, |(_, end)| end);
            if gap > WORD_GAP_EM * run.size && !line.ends_with(' ') && !run.text.starts_with(' ') {
                line.push(' ');
            }
            line.push_str(&run.text);
        } else {
            lines.push(run.text.clone());
        }
        last = Some((run.y, run.x + run.width));
    }
    lines
        .into_iter()
        .map(|line| line.trim_end().to_owned())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
