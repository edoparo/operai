//! Reading a compiled document: the text of each frame with its place on the page, the ink it draws, and the
//! characters a font lacked.
//!
//! This is what the outputs (T7: page text, the unprintable-character count) and the frame-level tests of the
//! layout (positions, margins, page breaks) are built on, so that both read the same frames the PDF and the
//! preview pages are made from.
//!
//! Positions are in pt on the page, y growing downwards, as Typst has them.

use typst::layout::{Frame, FrameItem, Point, Transform};
use typst::text::{FontStyle, Tag, TextItem};
use typst::visualize::Paint;
use typst_layout::Page;

/// A run of text as laid out.
#[derive(Debug, Clone, PartialEq)]
pub struct TextRun {
    /// The text of the run exactly as it was placed. Nothing is added or removed.
    pub text: String,
    /// Left edge of the run.
    pub x: f64,
    /// The baseline.
    pub y: f64,
    pub width: f64,
    pub size: f64,
    /// Glyphs of this run that are the font's missing-glyph mark (`.notdef`).
    pub unprintable: usize,
    /// The family of the font the run was set in.
    pub family: String,
    /// The weight the run is set in (400 regular, 700 bold, ...): the font file's, or for a variable font the
    /// `wght` value that Typst set.
    pub weight: u16,
    /// Set in an italic face (a file of its own, or the `ital` axis of a variable font).
    pub italic: bool,
    /// The fill, six lower-case hexadecimal digits; `None` if it is not a flat colour.
    pub fill: Option<String>,
}

/// What a frame draws, as a box on the page.
#[derive(Debug, Clone, PartialEq)]
pub struct Ink {
    pub kind: InkKind,
    /// The flat colour of a shape's fill or of a text's fill, six lower-case hexadecimal digits.
    pub fill: Option<String>,
    /// The flat colour of a shape's stroke.
    pub stroke: Option<String>,
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InkKind {
    Text,
    Shape,
    Image,
}

/// A flat colour as six lower-case hexadecimal digits.
fn flat(paint: &Paint) -> Option<String> {
    match paint {
        Paint::Solid(color) => {
            let hex = color.to_hex();
            Some(hex.trim_start_matches('#')[..6].to_lowercase())
        }
        _ => None,
    }
}

/// The value of a variation axis that Typst set for a run.
fn axis(text: &TextItem, tag: &[u8; 4]) -> Option<f32> {
    let tag = Tag::from_bytes(tag);
    text.font
        .variations()
        .0
        .iter()
        .find(|(t, _)| *t == tag)
        .map(|(_, value)| value.0)
}

/// Where the glyphs of a run sit above and below its baseline, as a share of its size. A run's ink box is
/// taken from these: the exact outline is the font's and the tests need only a box that is not too small.
const ASCENT: f64 = 0.8;
const DESCENT: f64 = 0.25;

fn walk(frame: &Frame, ts: Transform, visit: &mut impl FnMut(&FrameItem, Transform, Point)) {
    for (pos, item) in frame.items() {
        match item {
            FrameItem::Group(group) => {
                let inner = ts
                    .pre_concat(Transform::translate(pos.x, pos.y))
                    .pre_concat(group.transform);
                walk(&group.frame, inner, visit);
            }
            other => visit(other, ts, *pos),
        }
    }
}

/// Every run of text of a page, in the order the frame holds them.
pub fn text_runs(page: &Page) -> Vec<TextRun> {
    let mut runs = Vec::new();
    walk(&page.frame, Transform::identity(), &mut |item, ts, pos| {
        if let FrameItem::Text(text) = item {
            let at = pos.transform(ts);
            runs.push(TextRun {
                text: text.text.to_string(),
                x: at.x.to_pt(),
                y: at.y.to_pt(),
                width: text.width().to_pt() * ts.sx.get(),
                size: text.size.to_pt() * ts.sy.get(),
                unprintable: text.glyphs.iter().filter(|g| g.id == 0).count(),
                family: text.font.font().info().family.clone(),
                weight: axis(text, b"wght")
                    .map_or(text.font.font().info().variant.weight.to_number(), |w| {
                        w.round() as u16
                    }),
                italic: axis(text, b"ital").is_some_and(|v| v >= 0.5)
                    || text.font.font().info().variant.style != FontStyle::Normal,
                fill: match &text.fill {
                    Paint::Solid(color) => {
                        Some(color.to_hex().trim_start_matches('#')[..6].to_lowercase())
                    }
                    _ => None,
                },
            });
        }
    });
    runs
}

/// Every box a page draws: text, shapes (with their stroke) and images.
pub fn ink(page: &Page) -> Vec<Ink> {
    let mut boxes = Vec::new();
    walk(
        &page.frame,
        Transform::identity(),
        &mut |item, ts, pos| match item {
            FrameItem::Text(text) => {
                let at = pos.transform(ts);
                let width = text.width().to_pt() * ts.sx.get();
                let size = text.size.to_pt() * ts.sy.get();
                boxes.push(Ink {
                    kind: InkKind::Text,
                    fill: flat(&text.fill),
                    stroke: None,
                    left: at.x.to_pt(),
                    top: at.y.to_pt() - ASCENT * size,
                    right: at.x.to_pt() + width,
                    bottom: at.y.to_pt() + DESCENT * size,
                });
            }
            FrameItem::Shape(shape, _) => {
                let rect = shape.bbox(true);
                let a = Point::new(rect.min.x + pos.x, rect.min.y + pos.y).transform(ts);
                let b = Point::new(rect.max.x + pos.x, rect.max.y + pos.y).transform(ts);
                boxes.push(Ink {
                    kind: InkKind::Shape,
                    fill: shape.fill.as_ref().and_then(flat),
                    stroke: shape.stroke.as_ref().and_then(|s| flat(&s.paint)),
                    left: a.x.to_pt().min(b.x.to_pt()),
                    top: a.y.to_pt().min(b.y.to_pt()),
                    right: a.x.to_pt().max(b.x.to_pt()),
                    bottom: a.y.to_pt().max(b.y.to_pt()),
                });
            }
            FrameItem::Image(_, size, _) => {
                let a = pos.transform(ts);
                let b = Point::new(pos.x + size.x, pos.y + size.y).transform(ts);
                boxes.push(Ink {
                    kind: InkKind::Image,
                    fill: None,
                    stroke: None,
                    left: a.x.to_pt().min(b.x.to_pt()),
                    top: a.y.to_pt().min(b.y.to_pt()),
                    right: a.x.to_pt().max(b.x.to_pt()),
                    bottom: a.y.to_pt().max(b.y.to_pt()),
                });
            }
            _ => {}
        },
    );
    boxes
}

/// The characters of a page that its fonts do not hold (AC-7.6): glyphs that are `.notdef`. Typst draws the
/// font's mark for each of them (`fallback: false`), so the count is exact and which characters they were is
/// never kept.
pub fn unprintable_characters(page: &Page) -> usize {
    text_runs(page).iter().map(|r| r.unprintable).sum()
}

/// A line of text of a page: the runs that share a baseline, left to right.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    /// The baseline of the first run.
    pub y: f64,
    pub left: f64,
    pub right: f64,
    pub text: String,
    /// The size of the largest run.
    pub size: f64,
    pub runs: Vec<TextRun>,
}

/// Two runs are on one line when their baselines are less than this many pt apart.
const SAME_LINE_PT: f64 = 2.0;
/// A space is added between two runs of a line when the gap between them is more than this share of the
/// size of the second one and neither has a space at the join.
const WORD_GAP_EM: f64 = 0.15;

/// The lines of a page in reading order: top to bottom, and left to right within a line. Runs set beside each
/// other (the cells of a table row, a footer's zones) are one line, joined with a space where there is a gap
/// that is wider than a word space's share of the type size.
pub fn lines(page: &Page) -> Vec<Line> {
    let mut runs = text_runs(page);
    runs.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)));
    let mut groups: Vec<Vec<TextRun>> = Vec::new();
    for run in runs {
        match groups.last_mut() {
            Some(group) if (run.y - group[0].y).abs() < SAME_LINE_PT => group.push(run),
            _ => groups.push(vec![run]),
        }
    }
    groups
        .into_iter()
        .map(|mut group| {
            group.sort_by(|a, b| a.x.total_cmp(&b.x));
            let mut text = String::new();
            let mut end: Option<f64> = None;
            for run in &group {
                if let Some(end) = end
                    && run.x - end > WORD_GAP_EM * run.size
                    && !text.ends_with(' ')
                    && !run.text.starts_with(' ')
                {
                    text.push(' ');
                }
                text.push_str(&run.text);
                end = Some(run.x + run.width);
            }
            Line {
                y: group[0].y,
                left: group[0].x,
                right: end.unwrap_or(group[0].x),
                text,
                size: group.iter().map(|r| r.size).fold(0.0, f64::max),
                runs: group,
            }
        })
        .collect()
}
