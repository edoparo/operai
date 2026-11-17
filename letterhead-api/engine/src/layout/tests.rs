//! Tests of the layout as a whole (task T5): the registry, the fonts, the World's closed file set, characters
//! the fonts lack. Run: `cargo test -p letterhead-engine layout::`.

use serde_json::json;
use sha2::{Digest, Sha256};

use super::inspect::{self, InkKind};
use super::testing::*;
use super::*;
use crate::config::{Font, default_config};
use crate::world::{self, Access};

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn normalised(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ─── AC-7.5 the closed list of fonts ─────────────────────────────────────────

#[test]
fn ac_7_5_there_are_13_font_files_and_each_is_pinned_by_its_sha_256() {
    assert_eq!(LAYOUT_1_FONTS.len(), 13);
    for file in &LAYOUT_1_FONTS {
        assert_eq!(hex(file.bytes), file.sha256, "{} was replaced", file.file);
        assert_eq!(file.sha256.len(), 64);
    }
    let mut names: Vec<_> = LAYOUT_1_FONTS.iter().map(|f| f.file).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), 13, "no file twice");
}

#[test]
fn ac_7_5_every_file_is_a_face_of_the_family_it_is_listed_under() {
    let shared = LAYOUT_1.shared();
    assert_eq!(shared.fonts.len(), 13, "one face per file");
    for file in &LAYOUT_1_FONTS {
        let faces: Vec<_> =
            typst::text::Font::iter(typst::foundations::Bytes::new(file.bytes)).collect();
        assert_eq!(faces.len(), 1, "{}", file.file);
        assert_eq!(
            faces[0].info().family,
            typst_family(file.font),
            "{}",
            file.file
        );
    }
    // Each of the closed list's five families has a file.
    for font in Font::ALL {
        assert!(LAYOUT_1_FONTS.iter().any(|f| f.font == font), "{font:?}");
    }
}

#[test]
fn ac_7_5_each_family_has_a_licence_file_beside_the_fonts() {
    // The licence texts are part of what is shipped: the build fails if one is missing.
    for (family, text) in [
        ("DM Sans", include_str!("../../fonts/DMSans-OFL.txt")),
        ("DM Mono", include_str!("../../fonts/DMMono-OFL.txt")),
        ("Syne", include_str!("../../fonts/Syne-OFL.txt")),
        ("Noto Serif", include_str!("../../fonts/NotoSerif-OFL.txt")),
    ] {
        assert!(
            text.contains("SIL OPEN FONT LICENSE Version 1.1"),
            "{family}"
        );
    }
    assert!(include_str!("../../fonts/Ubuntu-UFL.txt").contains("UBUNTU FONT LICENCE Version 1.0"));
}

/// Italian, French and German letters with accents, the euro sign, "CHF" and the typographic apostrophe.
const COVERAGE: &str =
    "àèéìòù ÀÈÉÌÒÙ âêîôû ÂÊÎÔÛ äöüß ÄÖÜ ëïÿ çÇ ñ œŒ € CHF l’anno “così” – — «sì»";

#[test]
fn ac_7_5_every_font_prints_the_coverage_string_in_every_role() {
    for font in Font::ALL {
        let mut config = bare_config();
        config.fonts.body = font;
        config.fonts.heading = font;
        config.fonts.frame = font;
        config.variants.default.footer.left = vec![plain_line(COVERAGE)];
        let blocks = json!([heading(1, COVERAGE), paragraph(COVERAGE)]);
        let compiled = compiled(&config, &request("it", blocks));
        let page = &compiled.document.pages()[0];
        assert_eq!(inspect::unprintable_characters(page), 0, "{font:?}");
        let text = normalised(&page_text(&compiled, 1));
        assert_eq!(text.matches(COVERAGE).count(), 3, "{font:?}: {text}");
        // And the families asked for are the ones that drew them.
        for run in inspect::text_runs(page) {
            assert_eq!(run.family, typst_family(font), "{font:?}: {run:?}");
        }
    }
}

// ─── AC-7.6 characters the fonts lack ────────────────────────────────────────

#[test]
fn ac_7_6_a_missing_character_is_counted_and_drawn_as_a_visible_mark() {
    for font in Font::ALL {
        let mut config = bare_config();
        config.fonts.body = font;
        let compiled = compiled(
            &config,
            &request("it", json!([paragraph("Vai 漢字😀 ora")])),
        );
        let page = &compiled.document.pages()[0];
        // Three characters, counted by character and not by byte or UTF-16 unit.
        assert_eq!(inspect::unprintable_characters(page), 3, "{font:?}");
        // The text is what was sent.
        assert!(normalised(&page_text(&compiled, 1)).contains("Vai 漢字😀 ora"));
        // A mark is drawn where they are: ink in the box of the run's missing glyphs.
        let run = inspect::text_runs(page)
            .into_iter()
            .find(|r| r.unprintable > 0)
            .unwrap();
        let scale = 4.0_f64;
        let pixmap = typst_render::render(
            page,
            &typst_render::RenderOptions {
                pixel_per_pt: scale.into(),
                render_bleed: false,
            },
        );
        let (w, data) = (pixmap.width() as usize, pixmap.data());
        let ink_in = |x0: f64, x1: f64| {
            let (top, bottom) = (
                ((run.y - run.size * 0.7) * scale) as usize,
                (run.y * scale) as usize,
            );
            (top..bottom)
                .flat_map(|y| ((x0 * scale) as usize..(x1 * scale) as usize).map(move |x| (x, y)))
                .filter(|&(x, y)| {
                    data[(y * w + x) * 4..(y * w + x) * 4 + 3]
                        .iter()
                        .any(|&c| c < 200)
                })
                .count()
        };
        // The three marks together are the run's middle part; there is ink in each third of the run's width.
        let (x0, width) = (run.x, run.width);
        for part in 0..3 {
            let from = x0 + width * f64::from(part) / 3.0;
            assert!(
                ink_in(from, from + width / 3.0) > 10,
                "{font:?}: no mark in part {part} of {run:?}"
            );
        }
    }
}

#[test]
fn ac_7_6_the_count_is_exact_and_a_present_character_is_not_counted() {
    let compiled = compiled(
        &bare_config(),
        &request("it", json!([paragraph("漢字 😀 ⨌ ᚠ"), paragraph("è € ’")])),
    );
    assert_eq!(
        inspect::unprintable_characters(&compiled.document.pages()[0]),
        5
    );
}

#[test]
fn ac_7_6_a_missing_character_in_the_frame_is_counted_too() {
    let mut config = bare_config();
    config.variants.default.footer.left = vec![plain_line("{legal_name}")];
    let data = json!({ "legalName": "Società 漢" });
    let compiled = compiled(
        &config,
        &request_with("it", data, json!([paragraph("ciao")])),
    );
    assert_eq!(
        inspect::unprintable_characters(&compiled.document.pages()[0]),
        1
    );
}

// ─── AC-2.2 the World's closed file set ──────────────────────────────────────

fn served(accesses: &[Access]) -> Vec<String> {
    let mut paths: Vec<String> = accesses
        .iter()
        .filter(|a| a.served)
        .map(|a| a.path.clone())
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

/// The strings of the injection set of AC-2.1 and some of the spike's.
const INJECTION: [&str; 12] = [
    "#set page(width: 1cm)",
    "#read(\"/etc/hostname\")",
    "$x^2$",
    "*a*",
    "_a_",
    "`code`",
    "@label",
    "<label>",
    "\\",
    "{page}",
    "#image(\"/etc/passwd\") #plugin(\"x.wasm\") #eval(\"1\") #json(\"/data.json\") ]#panic(\"x\")[",
    "#import \"@preview/a:0.1.0\": *",
];

#[test]
fn ac_2_2_the_files_read_are_the_allowed_set_and_nothing_is_refused() {
    let mut config = brand_config();
    config.variants.default.background = Some(LOGO2_ID.to_owned());
    let mut blocks: Vec<_> = INJECTION.iter().map(|s| paragraph(s)).collect();
    // Three pages, so that the first, the default and the last variant are all drawn.
    for page in ["seconda", "terza"] {
        blocks.push(json!({ "type": "pageBreak" }));
        blocks.push(paragraph(&format!("pagina {page}")));
    }
    let data = json!({ "legalName": INJECTION[1], "contacts": INJECTION[10] });
    let compiled = compiled(&config, &request_with("it", data, json!(blocks)));
    // The default variant's background (slot 0), the first variant's logo and band (slots 1 and 2).
    assert_eq!(
        served(&compiled.accesses),
        vec!["/asset/0.png", "/asset/1.png", "/asset/2.svg", "/data.json"]
    );
    assert!(
        compiled.accesses.iter().all(|a| a.served),
        "{:?}",
        compiled.accesses
    );
    // Every string is on the page as it was typed.
    let text = normalised(
        &(1..=compiled.document.pages().len())
            .map(|p| page_text(&compiled, p))
            .collect::<Vec<_>>()
            .join(" "),
    );
    for s in INJECTION {
        assert!(text.contains(&normalised(s)), "{s}: not printed");
    }
    // The page set-up is unchanged: A4.
    for page in compiled.document.pages() {
        assert_eq!(page.frame.width().to_pt().round(), 595.0);
        assert_eq!(page.frame.height().to_pt().round(), 842.0);
    }
}

#[test]
fn ac_2_2_the_world_refuses_and_logs_any_other_file() {
    let layout = &LAYOUT_1;
    let world = world::LayoutWorld::new(
        layout.shared(),
        vec![("/data.json".to_owned(), b"{}".to_vec())],
    );
    use typst::World;
    assert!(world.file(world::id_of("/data.json")).is_ok());
    for path in [
        "/etc/hostname",
        "/etc/passwd",
        "/asset/0.png",
        "/img/0.png",
        "/other.typ",
    ] {
        assert!(world.file(world::id_of(path)).is_err(), "{path}");
        assert!(world.source(world::id_of(path)).is_err(), "{path}");
    }
    let accesses = world.accesses();
    assert_eq!(
        accesses[0],
        Access {
            path: "/data.json".to_owned(),
            served: true
        }
    );
    assert!(accesses[1..].iter().all(|a| !a.served));
    assert_eq!(accesses.len(), 1 + 2 * 5);
    // The template is served from the binary and is not a file.
    assert!(world.source(world.main()).is_ok());
    assert_eq!(world.accesses().len(), accesses.len());
}

#[test]
fn ac_7_5_the_world_has_no_font_path() {
    use typst::World;
    let world = world::LayoutWorld::new(LAYOUT_1.shared(), vec![]);
    assert_eq!(
        world.book().families().count(),
        5,
        "the five families of the closed list"
    );
    for index in 0..13 {
        assert!(world.font(index).is_some());
    }
    assert!(world.font(13).is_none());
    assert!(world.today(None).is_none());
}

#[test]
fn the_names_of_the_world_depend_on_the_sniffed_format_and_never_on_a_name() {
    assert_eq!(
        world::sniff(&png(2, 2, [0, 0, 0])),
        crate::assets::Format::Png
    );
    assert_eq!(
        world::sniff(&[0xFF, 0xD8, 0xFF, 0xE0]),
        crate::assets::Format::Jpeg
    );
    assert_eq!(world::sniff(&band_svg()), crate::assets::Format::Svg);
    assert_eq!(
        world::asset_path(3, crate::assets::Format::Jpeg),
        "/asset/3.jpg"
    );
    assert_eq!(
        world::image_path(12, crate::assets::Format::Svg),
        "/img/12.svg"
    );
}

// ─── AC-4.5 layouts are pinned ───────────────────────────────────────────────

#[test]
fn ac_4_5_layout_1_is_typst_0_15_1_and_a_number_this_binary_lacks_is_unknown() {
    let one = layout(1).expect("layout 1");
    assert_eq!((one.version, one.typst), (1, "0.15.1"));
    assert_eq!(CURRENT_LAYOUT, 1);
    assert!(layout(0).is_none());
    assert!(layout(2).is_none());
}

/// A layout 2 that is not layout 1: another template, and no fonts of its own beyond layout 1's.
static DUMMY_TEMPLATE: &str =
    "#let d = json(\"/data.json\")\n#set page(paper: \"a5\")\nLayout two: #d.language";
static DUMMY_LAYOUT: Layout = Layout::new(2, "0.15.1", DUMMY_TEMPLATE, &LAYOUT_1_FONTS);

#[test]
fn ac_4_5_adding_a_layout_leaves_layout_1_s_pages_unchanged() {
    let config = brand_config();
    let request = request_with("it", entity_data(), paragraphs(30, 30));
    let before = compile(&LAYOUT_1, &config, &assets(), &request).unwrap();
    let two = compile(&DUMMY_LAYOUT, &config, &assets(), &request).unwrap();
    // Layout 2 lays the same request out differently: that is what a new layout is for.
    assert_eq!(two.document.pages().len(), 1);
    assert_eq!(
        two.document.pages()[0].frame.width().to_pt().round(),
        420.0,
        "A5"
    );
    assert!(page_text(&two, 1).contains("Layout two: it"));
    let after = compile(&LAYOUT_1, &config, &assets(), &request).unwrap();
    assert_eq!(before.document.pages().len(), after.document.pages().len());
    for page in 0..before.document.pages().len() {
        assert_eq!(
            inspect::text_runs(&before.document.pages()[page]),
            inspect::text_runs(&after.document.pages()[page])
        );
        assert_eq!(
            inspect::ink(&before.document.pages()[page]),
            inspect::ink(&after.document.pages()[page])
        );
    }
}

#[test]
fn the_default_configuration_lays_out_and_fits() {
    let compiled = compiled(
        &default_config(),
        &request_with("it", entity_data(), paragraphs(3, 10)),
    );
    assert_eq!(compiled.document.pages().len(), 1);
    assert!(normalised(&page_text(&compiled, 1)).contains("WellD Sagl Via Pessina 9, 6900 Lugano"));
    let _ = InkKind::Text;
}

#[test]
fn a_text_that_does_not_parse_is_a_fault_of_the_caller_not_a_render() {
    let mut config = bare_config();
    config.variants.default.footer.left = vec![plain_line("{unknown}")];
    assert!(matches!(
        try_compile(&config, &request("it", json!([]))),
        Err(LayoutError::InvalidConfig { .. })
    ));
}
