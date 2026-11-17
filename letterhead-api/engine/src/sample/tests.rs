//! Tests of the sample document (task T16). Run: `cargo test -p letterhead-engine sample::`.

use std::collections::BTreeSet;

use super::*;
use crate::config::default_config;
use crate::content::{ingest_images, validate_request};
use crate::layout::{Assets, CURRENT_LAYOUT};
use crate::render::{LetterheadVersion, render};

fn every() -> Vec<(Entity, Language)> {
    Entity::ALL
        .into_iter()
        .flat_map(|e| Language::ALL.into_iter().map(move |l| (e, l)))
        .collect()
}

fn block_types(blocks: &[Block]) -> BTreeSet<&'static str> {
    blocks
        .iter()
        .map(|block| match block {
            Block::Heading(_) => "heading",
            Block::Paragraph(_) => "paragraph",
            Block::List(_) => "list",
            Block::Table(_) => "table",
            Block::Image(_) => "image",
            Block::PageBreak => "pageBreak",
        })
        .collect()
}

fn version() -> LetterheadVersion {
    LetterheadVersion {
        number: 0,
        layout_version: CURRENT_LAYOUT,
        config: default_config(),
    }
}

#[test]
fn the_sample_is_a_valid_request_in_every_entity_and_language() {
    for (entity, language) in every() {
        let sample = request(entity, language);
        let json = serde_json::to_value(&sample).expect("json");
        let validated = validate_request(&json)
            .unwrap_or_else(|why| panic!("{entity:?} {language:?} is refused: {why:?}"));
        assert_eq!(validated, sample, "it survives the content rules unchanged");
    }
}

#[test]
fn the_image_is_taken_by_the_asset_rules_as_it_is() {
    // The route runs `ingest_images` before the worker; the sample must already be what it returns, so that
    // the preview draws the file that is written here and not another.
    for (entity, language) in every() {
        let sample = request(entity, language);
        let mut ingested = sample.clone();
        ingest_images(&mut ingested).expect("the asset rules take the picture");
        assert_eq!(ingested, sample);
    }
}

#[test]
fn every_block_type_is_used() {
    for (entity, language) in every() {
        let used = block_types(&request(entity, language).blocks);
        let all: BTreeSet<&str> = [
            "heading",
            "paragraph",
            "list",
            "table",
            "image",
            "pageBreak",
        ]
        .into();
        assert_eq!(used, all);
    }
}

#[test]
fn every_named_style_emphasis_and_heading_level_is_used() {
    let sample = request(Entity::WelldIt, Language::En);
    let mut styles = std::collections::HashSet::new();
    let mut levels = BTreeSet::new();
    let (mut bold, mut italic, mut underline) = (false, false, false);
    let (mut ordered, mut unordered) = (false, false);
    for block in &sample.blocks {
        match block {
            Block::Heading(h) => {
                levels.insert(h.level);
            }
            Block::Paragraph(p) => {
                styles.extend(p.style);
                for run in &p.runs {
                    bold |= run.bold;
                    italic |= run.italic;
                    underline |= run.underline;
                }
            }
            Block::List(l) => {
                if l.ordered {
                    ordered = true;
                } else {
                    unordered = true;
                }
            }
            _ => {}
        }
    }
    assert_eq!(levels, BTreeSet::from([1, 2, 3]));
    // `plain` is the style of a paragraph that names none; the other six are each shown once.
    for style in Style::ALL.into_iter().filter(|s| *s != Style::Plain) {
        assert!(styles.contains(&style), "{style:?} is not shown");
    }
    assert!(bold && italic && underline && ordered && unordered);
}

#[test]
fn the_table_has_a_header_a_list_in_a_cell_and_as_many_cells_as_columns() {
    let sample = request(Entity::WelldIt, Language::It);
    let table = sample
        .blocks
        .iter()
        .find_map(|b| match b {
            Block::Table(t) => Some(t),
            _ => None,
        })
        .expect("a table");
    let header = table.header.as_ref().expect("a header row");
    assert_eq!(header.len(), table.columns.len());
    assert!(table.rows.iter().all(|r| r.len() == table.columns.len()));
    assert!(
        table
            .rows
            .iter()
            .flatten()
            .flatten()
            .any(|c| matches!(c, CellBlock::List(_)))
    );
}

#[test]
fn the_entity_data_is_all_marked_and_names_no_real_company() {
    for entity in Entity::ALL {
        let data = entity_data(entity);
        let mut values: Vec<String> = Vec::new();
        values.extend(data.legal_name.clone());
        values.extend(data.address_lines.clone().expect("address lines"));
        values.extend(data.vat.clone());
        values.extend(data.iban.clone());
        values.extend(data.contacts.clone());
        // All five placeholders have a value, so the preview never lists one as missing.
        assert!(
            data.legal_name.is_some()
                && data.vat.is_some()
                && data.iban.is_some()
                && data.contacts.is_some()
        );
        assert!(values.len() >= 6);
        for value in &values {
            assert!(value.ends_with(MARKER), "{value:?} is not marked");
            let lower = value.to_lowercase();
            for real in ["welld", "well-d", "well d"] {
                assert!(!lower.contains(real), "{value:?} names a real company");
            }
            // The fit check measures 40 characters (AC-5.2): a sample value never needs more room than that.
            assert!(
                value.chars().count() <= 40,
                "{value:?} is longer than the fit check's value"
            );
        }
    }
}

#[test]
fn the_sample_text_names_no_real_company_either() {
    for (entity, language) in every() {
        let json = serde_json::to_string(&request(entity, language).blocks)
            .expect("json")
            .to_lowercase();
        assert!(!json.contains("welld"));
    }
}

#[test]
fn it_and_en_differ_and_are_each_the_same_every_time() {
    let it = request(Entity::WelldIt, Language::It);
    let en = request(Entity::WelldIt, Language::En);
    assert_ne!(it.blocks, en.blocks);
    assert_eq!(it, request(Entity::WelldIt, Language::It));
    assert_ne!(
        request(Entity::WelldIt, Language::En).entity_data,
        request(Entity::WelldCh, Language::En).entity_data
    );
}

#[test]
fn the_sample_runs_to_at_least_three_pages_with_its_marker_and_every_block_in_the_text() {
    let expected: [(Language, &[&str]); 2] = [
        (
            Language::It,
            &[
                "Documento di esempio",    // heading 1
                "Titoli e paragrafi",      // heading 2
                "Stili del testo",         // heading 3
                "grassetto,",              // a bold run
                "Primo punto dell'elenco", // a list item
                "Primo passo numerato",    // a numbered item
                "Descrizione",             // the table header
                "Voce di esempio 01",      // a table row
                "Figura: un'immagine",     // the image's caption
                "Fine del documento",
            ],
        ),
        (
            Language::En,
            &[
                "Sample document",
                "Headings and paragraphs",
                "Text styles",
                "bold,",
                "First point of the list",
                "First numbered step",
                "Description",
                "Sample item 01",
                "Figure: a sample image",
                "End of the document",
            ],
        ),
    ];
    for entity in Entity::ALL {
        for (language, words) in expected {
            let rendered = render(&request(entity, language), &version(), &Assets::new())
                .unwrap_or_else(|why| panic!("{entity:?} {language:?}: {why}"));
            assert!(
                rendered.page_count >= 3,
                "{entity:?} {language:?}: {} pages",
                rendered.page_count
            );
            let texts = rendered.page_texts();
            let all = texts.join("\n");
            for word in words {
                assert!(
                    all.contains(word),
                    "{entity:?} {language:?}: {word:?} is not on any page"
                );
            }
            // The page breaks put the table on page 2 and the image's caption on the last page.
            assert!(texts[1].contains(words[6]), "the table starts page 2");
            assert!(
                texts.last().expect("a page").contains(words[8]),
                "the image is on the last page"
            );
            assert!(texts[0].contains(words[0]), "the title is on page 1");
            // The marker is visible: the default footer prints `{legal_name}` and `{address}`.
            assert!(
                texts.iter().all(|t| t.contains(MARKER)),
                "{entity:?} {language:?}: every page shows the marker"
            );
            assert!(rendered.missing_placeholders.is_empty());
            assert_eq!(rendered.unprintable_characters, 0);
        }
    }
}

#[test]
fn the_picture_is_drawn() {
    // A page with the picture has ink in it that a page of the same text without it has not: compare the
    // sample's last page with and without its image block.
    let with = request(Entity::WelldIt, Language::En);
    let mut without = with.clone();
    without.blocks.retain(|b| !matches!(b, Block::Image(_)));
    let a = render(&with, &version(), &Assets::new()).expect("with");
    let b = render(&without, &version(), &Assets::new()).expect("without");
    let last = |r: &crate::render::Rendered| {
        let page = r
            .preview(&crate::output::PageSelection::All)
            .expect("pages");
        page.last().expect("a page").png.clone()
    };
    assert_ne!(last(&a), last(&b));
}
