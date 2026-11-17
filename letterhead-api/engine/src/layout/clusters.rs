//! A cluster that Typst draws as several text items is one item (AC-1.3, AC-2.1).
//!
//! Typst cuts a shaped run into items wherever the vertical offset of the glyphs changes. A letter followed by
//! a combining mark that the font places by a vertical offset (U+0312 and others, and some marks on some bases)
//! therefore becomes two items, one for the letter (with the letters before it that sit on the same line) and
//! one for the mark, and when a cluster has glyphs on the line again after that, a third, which starts with
//! them. Each item carries the text of everything its glyphs cover, and the glyphs of a cluster point at the
//! cluster's whole text: so the items carry the cluster twice or three times. Everything that reads the text of
//! an item then reads the cluster that many times: the page text of a preview, and the text that a PDF reader
//! extracts (the PDF's ToUnicode entries of the glyphs are the whole cluster). A soft hyphen at which a line
//! ends (or at the end of a text) is the same: the item before it already holds it, in the text of its last
//! cluster, and Typst adds the hyphen it draws as an item whose text is the soft hyphen again.
//!
//! The fix is made once, on the laid-out document, so that the PDF, the preview and the page text are of the
//! same document (A5): the glyphs of the cluster that are in the later items are moved into the item that holds
//! its first glyphs, which is what Typst does for the glyphs of one cluster that sit on one line. Each glyph
//! keeps its place (the vertical offset of its item becomes the glyph's own `y_offset`, which the PDF and the
//! preview both draw; an item that loses glyphs from its start moves right by their width), the cluster is the
//! text of the item once, and each glyph of it is given its own character of the cluster as its text, so that the
//! PDF says what each glyph is. Nothing about what is drawn changes.
//!
//! A glyph is of the cluster that the item before it ends with only if it comes from the same place in the
//! same text (Typst records it for every glyph), is set in the same font and size, sits at that item's right
//! end and on its line, and the text of its item starts with the text of that cluster: a second occurrence of
//! the same letters, typed again, is not a glyph of the first.

use std::collections::BTreeSet;

use typst::layout::{Abs, Em, Frame, FrameItem, Point};
use typst::syntax::Span;
use typst::text::{FontInstance, Glyph, TextItem};
use typst_layout::PagedDocument;

/// How far from the previous item's right end a glyph may start, in pt (the font's own offsets).
const SLACK_PT: f64 = 0.5;

const SOFT_HYPHEN: &str = "\u{ad}";

/// The document with every such cluster in one item. The pages are rebuilt into a new document (the type has
/// no way to change its pages in place), whose introspector is built from them.
pub(super) fn write_clusters_once(mut document: PagedDocument) -> PagedDocument {
    let info = document.info_mut().clone();
    let mut pages = document.pages().to_vec();
    for page in &mut pages {
        merge(&mut page.frame);
    }
    PagedDocument::new(pages.into(), info)
}

/// The previous text item of a frame: where it is, and its last cluster.
struct Previous {
    index: usize,
    at: Point,
    end: f64,
    size: Abs,
    font: FontInstance,
    text: String,
    /// What the item's last glyph covers: the text of its last cluster, where it is in the item's text, and
    /// where it comes from.
    last_cluster: String,
    last_range: std::ops::Range<u16>,
    last_span: (Span, u16),
}

impl Previous {
    fn of(index: usize, at: Point, item: &TextItem) -> Option<Previous> {
        let last = item.glyphs.last()?;
        Some(Previous {
            index,
            at,
            end: at.x.to_pt() + item.width().to_pt(),
            size: item.size,
            font: item.font.clone(),
            text: item.text.to_string(),
            last_cluster: item
                .text
                .get(usize::from(last.range.start)..usize::from(last.range.end))?
                .to_owned(),
            last_range: last.range.clone(),
            last_span: last.span,
        })
    }
}

/// The glyphs at the start of an item that belong to the cluster that the item before it ends with.
struct Lead {
    glyphs: usize,
    bytes: u16,
}

/// Put the clusters of a frame, and of the frames in it, in one item each. Whether anything was changed.
fn merge(frame: &mut Frame) -> bool {
    if !has_split_cluster(frame) {
        return false;
    }
    let mut items: Vec<(Point, FrameItem)> = frame.items().cloned().collect();
    let mut dropped = vec![false; items.len()];
    let mut spread: BTreeSet<usize> = BTreeSet::new();
    let mut previous: Option<Previous> = None;
    for index in 0..items.len() {
        if let FrameItem::Group(group) = &mut items[index].1 {
            merge(&mut group.frame);
            continue;
        }
        let (earlier, later) = items.split_at_mut(index);
        let (pos, FrameItem::Text(text)) = (&mut later[0].0, &mut later[0].1) else {
            continue;
        };
        if text.glyphs.is_empty() {
            continue;
        }
        let lead = previous
            .as_ref()
            .and_then(|before| continues(text, *pos, before));
        let (Some(lead), Some(before)) = (lead, previous.as_mut()) else {
            previous = Previous::of(index, *pos, text);
            continue;
        };
        // Move the glyphs to the item that holds the cluster's first glyphs.
        let FrameItem::Text(first) = &mut earlier[before.index].1 else {
            unreachable!("the previous item is text");
        };
        let rise = before.at.y - pos.y;
        let moved: Vec<Glyph> = text.glyphs.drain(..lead.glyphs).collect();
        let advance: f64 = moved
            .iter()
            .map(|g| g.x_advance.at(text.size).to_pt())
            .sum();
        first.glyphs.extend(moved.into_iter().map(|g| Glyph {
            y_offset: g.y_offset + Em::from_abs(rise, text.size),
            range: before.last_range.clone(),
            ..g
        }));
        spread.insert(before.index);
        before.end += advance;
        if text.glyphs.is_empty() {
            dropped[index] = true;
            continue;
        }
        // What is left is an item of its own, from the end of the cluster on, and it starts further right.
        for glyph in &mut text.glyphs {
            glyph.range = glyph.range.start.saturating_sub(lead.bytes)
                ..glyph.range.end.saturating_sub(lead.bytes);
        }
        text.text = text
            .text
            .get(usize::from(lead.bytes)..)
            .unwrap_or_default()
            .into();
        pos.x += Abs::pt(advance);
        previous = Previous::of(index, *pos, text);
    }
    for index in spread {
        if let FrameItem::Text(item) = &mut items[index].1 {
            spread_cluster(item);
        }
    }
    frame.clear();
    for ((pos, item), dropped) in items.into_iter().zip(dropped) {
        if !dropped {
            frame.push(pos, item);
        }
    }
    true
}

/// Is there, in this frame or one in it, an item that starts with glyphs of the cluster that the item before it
/// ends with? Most frames have none, and are not touched.
fn has_split_cluster(frame: &Frame) -> bool {
    let mut previous: Option<Previous> = None;
    for (index, (pos, item)) in frame.items().enumerate() {
        match item {
            FrameItem::Group(group) => {
                if has_split_cluster(&group.frame) {
                    return true;
                }
            }
            FrameItem::Text(text) if !text.glyphs.is_empty() => {
                if previous
                    .as_ref()
                    .is_some_and(|before| continues(text, *pos, before).is_some())
                {
                    return true;
                }
                previous = Previous::of(index, *pos, text);
            }
            _ => {}
        }
    }
    false
}

/// Does `item`, at `pos`, start with glyphs of the cluster that `before` ends with? Then which.
fn continues(item: &TextItem, pos: Point, before: &Previous) -> Option<Lead> {
    let beside = pos.x.to_pt() >= before.at.x.to_pt() - SLACK_PT
        && pos.x.to_pt() <= before.end + SLACK_PT
        && (pos.y.to_pt() - before.at.y.to_pt()).abs() <= before.size.to_pt();
    if !beside || item.font != before.font || item.size != before.size || item.glyphs.is_empty() {
        return None;
    }
    // The hyphen that Typst draws where a line ends at a soft hyphen: an item of its own, whose text is the soft
    // hyphen that the item before it ends with.
    if item.text.as_str() == SOFT_HYPHEN && before.text.ends_with(SOFT_HYPHEN) {
        return Some(Lead {
            glyphs: item.glyphs.len(),
            bytes: SOFT_HYPHEN.len() as u16,
        });
    }
    // Glyphs of the cluster: they cover the text of the cluster that the item before it ends with, and come from
    // the same place in the text. They are an item of their own when the item after them is at another height,
    // and the first glyphs of the next item when it is at the same height, which then goes on with the text
    // after the cluster.
    let cluster = before.last_cluster.as_str();
    let bytes = u16::try_from(cluster.len()).ok()?;
    if bytes == 0 || !item.text.starts_with(cluster) {
        return None;
    }
    let glyphs = item
        .glyphs
        .iter()
        .take_while(|g| g.range.start == 0 && g.range.end == bytes && g.span == before.last_span)
        .count();
    // An item that is the cluster and nothing else is all of it moved.
    if item.text.len() == cluster.len() && glyphs != item.glyphs.len() {
        return None;
    }
    (glyphs > 0).then_some(Lead { glyphs, bytes })
}

/// Give each glyph of the last cluster of an item its own part of the cluster's text, one character to a glyph
/// (the last glyph takes what is left). A PDF reader reads a glyph's text from the glyph: with the cluster's
/// whole text on each glyph, a reader that takes the text of each glyph (pdfium does) reads the cluster once
/// for each of them, and one that takes it from the cluster (a marked-content span) is left to guess which of
/// the glyphs it belongs to. With one character to a glyph the letter is the letter and the mark is the mark,
/// as it is for every glyph that stands alone.
fn spread_cluster(item: &mut TextItem) {
    let Some(cluster) = item.glyphs.last().map(|g| g.range.clone()) else {
        return;
    };
    let glyphs: Vec<usize> = (0..item.glyphs.len())
        .rev()
        .take_while(|&i| item.glyphs[i].range == cluster)
        .collect();
    let Some(text) = item
        .text
        .get(usize::from(cluster.start)..usize::from(cluster.end))
    else {
        return;
    };
    // The byte offsets in the item's text at which each character of the cluster starts, and where it ends.
    let mut bounds: Vec<u16> = text
        .char_indices()
        .map(|(at, _)| cluster.start + at as u16)
        .collect();
    bounds.push(cluster.end);
    let chars = bounds.len() - 1;
    if chars == 0 {
        return;
    }
    // `glyphs` runs from the last glyph backwards. Glyphs past the last character share it.
    let count = glyphs.len();
    for (t, &glyph) in glyphs.iter().rev().enumerate() {
        let c = t.min(chars - 1);
        let end = if t == count - 1 {
            cluster.end
        } else {
            bounds[c + 1]
        };
        item.glyphs[glyph].range = bounds[c]..end;
    }
}
