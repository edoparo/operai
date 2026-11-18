//! Tests of the letterhead configuration (task T3). Run: `cargo test -p letterhead-engine config::`.

use serde_json::{Value, json};

use super::bounds;
use super::*;
use crate::content::Language;

const LOGO_ID: &str = "0b9a3f0e-5d2c-4b8e-9a43-1c2d3e4f5a6b";
const BG_ID: &str = "7f3c9d10-aaaa-4bbb-8ccc-0123456789ab";

fn base() -> Value {
    serde_json::to_value(default_config()).expect("json")
}

/// The default, plus a first-page and a last-page variant with a logo and a background each.
fn rich() -> Value {
    let mut value = base();
    let mut first = value["variants"]["default"].clone();
    first["logo"] = json!({ "asset": LOGO_ID, "position": "left", "heightMm": 12.7 });
    first["background"] = json!(BG_ID);
    let mut last = value["variants"]["default"].clone();
    last["footer"]["left"][0]["text"] = json!({ "it": "Fine", "en": "End" });
    value["variants"]["first"] = first;
    value["variants"]["last"] = last;
    value
}

fn set(mut value: Value, pointer: &str, replacement: Value) -> Value {
    *value
        .pointer_mut(pointer)
        .unwrap_or_else(|| panic!("no {pointer}")) = replacement;
    value
}

fn remove(mut value: Value, pointer: &str) -> Value {
    let (parent, key) = pointer.rsplit_once('/').expect("parent");
    match value.pointer_mut(parent).expect("parent exists") {
        Value::Object(map) => {
            map.remove(key).expect("member");
        }
        other => panic!("{other}"),
    }
    value
}

fn problems(value: &Value) -> Vec<Problem> {
    validate_config(value).expect_err("expected a refusal")
}

/// (path, reason) of every problem.
fn pairs(value: &Value) -> Vec<(String, &'static str)> {
    problems(value)
        .into_iter()
        .map(|p| (p.path, p.reason.as_str()))
        .collect()
}

fn one(value: &Value) -> Problem {
    let mut all = problems(value);
    assert_eq!(all.len(), 1, "{all:?}");
    all.remove(0)
}

fn expect(value: &Value, path: &str, reason: &str) -> Problem {
    let found = one(value);
    assert_eq!(
        (found.path.as_str(), found.reason.as_str()),
        (path, reason),
        "{found:?}"
    );
    found
}

fn typed(value: &Value) -> LetterheadConfig {
    validate_config(value).unwrap_or_else(|p| panic!("{p:?}"))
}

mod default_and_shape {
    use super::*;

    #[test]
    fn the_default_config_validates_clean_and_is_what_comes_back() {
        let value = base();
        let config = typed(&value);
        assert_eq!(config, default_config());
        // stored as JSON and read back by serde: the same
        let back: LetterheadConfig = serde_json::from_value(value).expect("deserialise");
        assert_eq!(back, config);
    }

    #[test]
    fn the_default_config_is_what_the_plan_says() {
        let config = default_config();
        let m = config.margins;
        assert_eq!((m.top, m.bottom, m.left, m.right), (25.0, 25.0, 25.0, 25.0));
        assert_eq!(config.fonts.body, Font::NotoSerif);
        assert_eq!(config.fonts.heading, Font::Ubuntu);
        assert_eq!(config.fonts.frame, Font::Ubuntu);
        let footer = &config.variants.default.footer;
        let texts = |lines: &[Line]| lines.iter().map(|l| l.text.it.clone()).collect::<Vec<_>>();
        assert_eq!(texts(&footer.left), ["{legal_name}", "{address}"]);
        assert_eq!(texts(&footer.right), ["{page} / {pages}"]);
        assert!(footer.center.is_empty());
        assert!(config.variants.default.logo.is_none());
        assert!(config.variants.first.is_none() && config.variants.last.is_none());
        // both languages are filled for every line (AC-5.8)
        for line in footer.left.iter().chain(&footer.right) {
            assert_eq!(line.text.it, line.text.en);
        }
    }

    #[test]
    fn a_rich_config_validates_and_lists_its_assets_once_each() {
        let config = typed(&rich());
        assert_eq!(config.asset_ids(), [LOGO_ID, BG_ID]);
        assert_eq!(typed(&base()).asset_ids(), Vec::<&str>::new());
        // the same logo in two variants is one asset
        let mut value = rich();
        value["variants"]["last"]["logo"] =
            json!({ "asset": LOGO_ID, "position": "right", "heightMm": 6 });
        assert_eq!(typed(&value).asset_ids(), [LOGO_ID, BG_ID]);
    }

    #[test]
    fn first_and_last_may_be_absent_or_null_and_colours_and_ids_are_lower_cased() {
        let value = remove(base(), "/variants/first");
        assert!(typed(&value).variants.first.is_none());
        let value = set(base(), "/variants/last", Value::Null);
        assert!(typed(&value).variants.last.is_none());

        let mut value = rich();
        value["look"]["headings"][0]["color"] = json!("E50339");
        value["variants"]["first"]["logo"]["asset"] = json!(LOGO_ID.to_uppercase());
        let config = typed(&value);
        assert_eq!(config.look.headings[0].color, "e50339");
        assert_eq!(config.asset_ids()[0], LOGO_ID);
    }

    #[test]
    fn inter_is_accepted_for_the_body_the_headings_and_the_frame() {
        let mut value = base();
        value["fonts"] = json!({ "body": "Inter", "heading": "Inter", "frame": "Inter" });
        let config = typed(&value);
        assert_eq!(config.fonts.body, Font::Inter);
        assert_eq!(config.fonts.heading, Font::Inter);
        assert_eq!(config.fonts.frame, Font::Inter);
        // It is stored as "Inter" and reads back.
        let stored = serde_json::to_value(&config).expect("json");
        assert_eq!(stored["fonts"]["body"], json!("Inter"));
        assert_eq!(
            serde_json::from_value::<LetterheadConfig>(stored).expect("back"),
            config
        );
        // Only the exact name: the list is closed and case-sensitive.
        for wrong in ["inter", "Inter Tight", "Inter Display", "INTER"] {
            let value = set(base(), "/fonts/body", json!(wrong));
            expect(&value, "/fonts/body", "unknown_font");
        }
    }

    #[test]
    fn the_font_list_is_the_six_families() {
        let names: Vec<&str> = Font::ALL.iter().map(|f| f.name()).collect();
        assert_eq!(
            names,
            [
                "DM Sans",
                "DM Mono",
                "Syne",
                "Ubuntu",
                "Noto Serif",
                "Inter"
            ]
        );
        for font in Font::ALL {
            assert_eq!(
                serde_json::to_value(font).expect("json"),
                json!(font.name())
            );
            assert_eq!(Font::parse(font.name()), Some(font));
        }
        assert_eq!(Font::parse("Comic Sans"), None);
        assert_eq!(Font::parse("ubuntu"), None);
    }
}

mod structure {
    use super::*;

    #[test]
    fn a_config_that_is_not_an_object_or_lacks_a_part() {
        assert_eq!(pairs(&json!([])), [("".into(), "wrong_type")]);
        assert_eq!(pairs(&json!("x")), [("".into(), "wrong_type")]);
        for part in ["margins", "fonts", "look", "variants"] {
            let value = remove(base(), &format!("/{part}"));
            expect(&value, &format!("/{part}"), "missing_member");
        }
        assert_eq!(
            pairs(&json!({})),
            [
                ("/margins".to_owned(), "missing_member"),
                ("/fonts".into(), "missing_member"),
                ("/look".into(), "missing_member"),
                ("/variants".into(), "missing_member"),
            ]
        );
    }

    #[test]
    fn unknown_members_are_refused_at_their_object() {
        for (pointer, at) in [
            ("", ""),
            ("/margins", "/margins"),
            ("/fonts", "/fonts"),
            ("/look", "/look"),
            ("/look/body", "/look/body"),
            ("/look/table", "/look/table"),
            ("/look/headings/0", "/look/headings/0"),
            ("/variants", "/variants"),
            ("/variants/default", "/variants/default"),
            ("/variants/default/header", "/variants/default/header"),
            (
                "/variants/default/footer/rule",
                "/variants/default/footer/rule",
            ),
            (
                "/variants/default/footer/left/0",
                "/variants/default/footer/left/0",
            ),
            (
                "/variants/default/footer/left/0/text",
                "/variants/default/footer/left/0/text",
            ),
        ] {
            let mut value = base();
            let target = if pointer.is_empty() {
                &mut value
            } else {
                value.pointer_mut(pointer).expect("pointer")
            };
            target["ZQX"] = json!(1);
            let found = expect(&value, at, "unknown_member");
            // the name of the unknown member is not echoed
            assert!(!format!("{found:?}").contains("ZQX"));
        }
    }

    #[test]
    fn a_logo_object_with_an_unknown_member() {
        let mut value = rich();
        value["variants"]["first"]["logo"]["crop"] = json!(1);
        expect(&value, "/variants/first/logo", "unknown_member");
    }

    #[test]
    fn wrong_types() {
        for (pointer, bad, reason) in [
            ("/margins", json!([]), "wrong_type"),
            ("/look/headings", json!({}), "wrong_type"),
            ("/look/headings/0/bold", json!("yes"), "wrong_type"),
            ("/look/table/borders", json!(1), "wrong_type"),
            (
                "/variants/default/footer/rule/show",
                json!("true"),
                "wrong_type",
            ),
            ("/variants/default/footer/left", json!("x"), "wrong_type"),
            (
                "/variants/default/footer/left/0/bold",
                json!(null),
                "wrong_type",
            ),
            (
                "/variants/default/footer/left/0/text/it",
                json!(3),
                "wrong_type",
            ),
            ("/variants/default/footer/left/0", json!(7), "wrong_type"),
            (
                "/variants/default/footer/left/0/text",
                json!("x"),
                "wrong_type",
            ),
            ("/variants", json!([]), "wrong_type"),
        ] {
            let value = set(base(), pointer, bad);
            let paths: Vec<_> = pairs(&value);
            assert!(
                paths.contains(&(pointer.to_owned(), reason)),
                "{pointer}: {paths:?}"
            );
        }
    }

    #[test]
    fn every_problem_is_listed_in_document_order() {
        let mut value = base();
        value["margins"]["top"] = json!(1);
        value["fonts"]["body"] = json!("Papyrus");
        value["look"]["body"]["size"] = json!(99);
        value["variants"]["default"]["footer"]["left"][0]["color"] = json!("zzz");
        assert_eq!(
            pairs(&value),
            [
                ("/margins/top".to_owned(), "out_of_range"),
                ("/fonts/body".into(), "unknown_font"),
                ("/look/body/size".into(), "out_of_range"),
                ("/variants/default/footer/left/0/color".into(), "bad_colour"),
            ]
        );
    }
}

mod bounds_one_test_each {
    use super::*;

    /// A bound is accepted at both ends and refused just outside, naming the option.
    fn check_range(pointer: &str, range: bounds::Range, name: &str) {
        for ok in [range.min, range.max, (range.min + range.max) / 2.0] {
            let value = set(base_for(pointer), pointer, json!(ok));
            assert!(
                validate_config(&value).is_ok(),
                "{pointer} = {ok}: {:?}",
                validate_config(&value)
            );
        }
        for bad in [
            range.min - 0.01,
            range.max + 0.01,
            range.min - 100.0,
            range.max * 10.0,
        ] {
            let value = set(base_for(pointer), pointer, json!(bad));
            let found = expect(&value, pointer, "out_of_range");
            assert_eq!(found.name.as_deref(), Some(name), "{pointer}");
        }
        let value = set(base_for(pointer), pointer, json!("10"));
        let found = expect(&value, pointer, "not_a_number");
        assert_eq!(found.name.as_deref(), Some(name));
        let value = set(base_for(pointer), pointer, json!(null));
        expect(&value, pointer, "not_a_number");
    }

    /// Every variant uses `rich()` so that the logo and the other parts exist.
    fn base_for(_pointer: &str) -> Value {
        rich()
    }

    #[test]
    fn margins_are_5_to_100_mm() {
        for side in ["top", "bottom", "left", "right"] {
            // keep the body area valid at the extremes: set the opposite margin low
            let pointer = format!("/margins/{side}");
            for ok in [5.0, 25.4, 40.0] {
                assert!(
                    validate_config(&set(base(), &pointer, json!(ok))).is_ok(),
                    "{side} {ok}"
                );
            }
            for bad in [4.99, 100.01, -1.0, 0.0] {
                let found = expect(&set(base(), &pointer, json!(bad)), &pointer, "out_of_range");
                assert_eq!(found.name.as_deref(), Some(side));
            }
            expect(
                &set(base(), &pointer, json!("25")),
                &pointer,
                "not_a_number",
            );
            expect(&remove(base(), &pointer), &pointer, "missing_member");
        }
        // 100 mm is allowed where the body still fits
        let mut value = base();
        value["margins"] = json!({ "top": 5, "bottom": 5, "left": 100, "right": 5 });
        assert!(validate_config(&value).is_ok());
    }

    #[test]
    fn the_document_title_size_is_8_to_36_pt() {
        check_range("/look/title/size", bounds::TITLE_SIZE_PT, "size");
        assert_eq!(
            (bounds::TITLE_SIZE_PT.min, bounds::TITLE_SIZE_PT.max),
            (8.0, 36.0)
        );
    }

    #[test]
    fn heading_size_is_8_to_24_pt_for_each_level() {
        for level in 0..3 {
            check_range(
                &format!("/look/headings/{level}/size"),
                bounds::HEADING_SIZE_PT,
                "size",
            );
        }
    }

    #[test]
    fn body_size_is_8_to_14_pt() {
        check_range("/look/body/size", bounds::BODY_SIZE_PT, "size");
    }

    #[test]
    fn line_spacing_is_1_to_2() {
        check_range(
            "/look/body/lineSpacing",
            bounds::LINE_SPACING,
            "lineSpacing",
        );
    }

    #[test]
    fn a_header_or_footer_line_is_6_to_14_pt() {
        check_range(
            "/variants/default/footer/left/0/size",
            bounds::LINE_SIZE_PT,
            "size",
        );
        check_range(
            "/variants/first/footer/right/0/size",
            bounds::LINE_SIZE_PT,
            "size",
        );
    }

    #[test]
    fn a_rule_has_a_bounded_thickness() {
        check_range(
            "/variants/default/footer/rule/thicknessPt",
            bounds::RULE_THICKNESS_PT,
            "thicknessPt",
        );
        check_range(
            "/variants/default/header/rule/thicknessPt",
            bounds::RULE_THICKNESS_PT,
            "thicknessPt",
        );
    }

    #[test]
    fn the_distance_of_a_frame_from_the_body_is_0_to_40_mm() {
        for pointer in [
            "/variants/default/header/gapMm",
            "/variants/default/footer/gapMm",
            "/variants/first/header/gapMm",
            "/variants/last/footer/gapMm",
        ] {
            check_range(pointer, bounds::GAP_MM, "gapMm");
        }
    }

    #[test]
    fn a_logo_is_5_to_40_mm_high() {
        check_range(
            "/variants/first/logo/heightMm",
            bounds::LOGO_HEIGHT_MM,
            "heightMm",
        );
    }

    #[test]
    fn the_bounds_are_the_ones_the_spec_states() {
        assert_eq!((bounds::MARGIN_MM.min, bounds::MARGIN_MM.max), (5.0, 100.0));
        assert_eq!(
            (bounds::BODY_MIN_WIDTH_MM, bounds::BODY_MIN_HEIGHT_MM),
            (100.0, 150.0)
        );
        assert_eq!(bounds::MAX_LINES_PER_ZONE, 4);
        assert_eq!(bounds::FIT_TEST_VALUE_CHARS, 40);
        assert_eq!(
            (bounds::LINE_SIZE_PT.min, bounds::LINE_SIZE_PT.max),
            (6.0, 14.0)
        );
        assert_eq!(
            (bounds::HEADING_SIZE_PT.min, bounds::HEADING_SIZE_PT.max),
            (8.0, 24.0)
        );
        assert_eq!(
            (bounds::BODY_SIZE_PT.min, bounds::BODY_SIZE_PT.max),
            (8.0, 14.0)
        );
        assert_eq!(
            (bounds::LINE_SPACING.min, bounds::LINE_SPACING.max),
            (1.0, 2.0)
        );
        assert_eq!(
            (bounds::LOGO_HEIGHT_MM.min, bounds::LOGO_HEIGHT_MM.max),
            (5.0, 40.0)
        );
        assert_eq!((bounds::GAP_MM.min, bounds::GAP_MM.max), (0.0, 40.0));
        assert_eq!(bounds::DEFAULT_GAP_MM, 3.0);
        assert_eq!(bounds::HEADING_LEVELS, 3);
    }

    #[test]
    fn there_are_exactly_three_heading_levels() {
        let one_less = {
            let mut value = base();
            value["look"]["headings"]
                .as_array_mut()
                .expect("array")
                .pop();
            value
        };
        expect(&one_less, "/look/headings", "out_of_range");
        let one_more = {
            let mut value = base();
            let extra = value["look"]["headings"][0].clone();
            value["look"]["headings"]
                .as_array_mut()
                .expect("array")
                .push(extra);
            value
        };
        expect(&one_more, "/look/headings", "out_of_range");
    }

    #[test]
    fn at_most_four_lines_per_zone() {
        for zone in ["left", "center", "right"] {
            for frame in ["header", "footer"] {
                let pointer = format!("/variants/default/{frame}/{zone}");
                let line = base()["variants"]["default"]["footer"]["left"][0].clone();
                for n in 0..=4 {
                    let lines = Value::Array((0..n).map(|_| line.clone()).collect());
                    assert!(
                        validate_config(&set(base(), &pointer, lines)).is_ok(),
                        "{pointer} {n}"
                    );
                }
                let five = Value::Array((0..5).map(|_| line.clone()).collect());
                expect(&set(base(), &pointer, five), &pointer, "too_many_lines");
            }
        }
    }

    #[test]
    fn a_huge_zone_is_one_problem_and_its_lines_are_not_read() {
        let mut line = base()["variants"]["default"]["footer"]["left"][0].clone();
        line["color"] = json!("bad");
        let lines = Value::Array((0..100_000).map(|_| line.clone()).collect());
        let value = set(base(), "/variants/default/header/left", lines);
        expect(&value, "/variants/default/header/left", "too_many_lines");
    }

    #[test]
    fn the_first_and_last_variants_are_bounded_like_the_default() {
        for variant in ["first", "last"] {
            let value = set(
                rich(),
                &format!("/variants/{variant}/footer/left/0/size"),
                json!(15),
            );
            expect(
                &value,
                &format!("/variants/{variant}/footer/left/0/size"),
                "out_of_range",
            );
            let five = Value::Array((0..5).map(|_| json!({"text": {"it":"a","en":"a"}, "size": 8, "bold": false, "color": "000000"})).collect());
            let value = set(rich(), &format!("/variants/{variant}/header/right"), five);
            expect(
                &value,
                &format!("/variants/{variant}/header/right"),
                "too_many_lines",
            );
        }
    }
}

mod body_area {
    use super::*;

    fn margins(top: f64, bottom: f64, left: f64, right: f64) -> Value {
        set(
            base(),
            "/margins",
            json!({ "top": top, "bottom": bottom, "left": left, "right": right }),
        )
    }

    #[test]
    fn exactly_100_by_150_is_allowed() {
        assert!(validate_config(&margins(73.5, 73.5, 55.0, 55.0)).is_ok());
        assert!(validate_config(&margins(5.0, 5.0, 5.0, 5.0)).is_ok());
    }

    #[test]
    fn a_body_narrower_than_100_mm_names_both_horizontal_margins() {
        let value = margins(25.0, 25.0, 55.1, 55.0);
        assert_eq!(
            pairs(&value),
            [
                ("/margins/left".to_owned(), "body_too_small"),
                ("/margins/right".into(), "body_too_small")
            ]
        );
        let found = problems(&value);
        assert_eq!(found[0].name.as_deref(), Some("left"));
    }

    #[test]
    fn a_body_lower_than_150_mm_names_both_vertical_margins() {
        let value = margins(73.6, 73.5, 25.0, 25.0);
        assert_eq!(
            pairs(&value),
            [
                ("/margins/top".to_owned(), "body_too_small"),
                ("/margins/bottom".into(), "body_too_small")
            ]
        );
    }

    #[test]
    fn both_axes_can_be_too_small_and_a_bad_margin_hides_the_check() {
        assert_eq!(problems(&margins(100.0, 100.0, 100.0, 100.0)).len(), 4);
        let value = margins(100.0, 100.0, 100.0, 120.0);
        assert_eq!(
            pairs(&value),
            [("/margins/right".to_owned(), "out_of_range")]
        );
    }
}

mod colours_and_choices {
    use super::*;

    const COLOUR_PATHS: [&str; 8] = [
        "/look/headings/0/color",
        "/look/title/color",
        "/look/headings/2/color",
        "/look/table/headerFill",
        "/look/table/borderColor",
        "/variants/default/footer/rule/color",
        "/variants/default/header/rule/color",
        "/variants/default/footer/left/1/color",
    ];

    #[test]
    fn a_colour_is_six_hex_digits() {
        for pointer in COLOUR_PATHS {
            for ok in ["e50339", "E50339", "000000", "ffffff", "aBcDeF"] {
                assert!(
                    validate_config(&set(base(), pointer, json!(ok))).is_ok(),
                    "{pointer} {ok}"
                );
            }
            for bad in [
                "", "#e50339", "e5033", "e503391", "gggggg", "red", "e5 339", "é50339", " e50339",
            ] {
                let found = expect(&set(base(), pointer, json!(bad)), pointer, "bad_colour");
                assert!(found.name.is_some());
            }
            expect(
                &set(base(), pointer, json!(0xe50339)),
                pointer,
                "bad_colour",
            );
            expect(&set(base(), pointer, json!(null)), pointer, "bad_colour");
        }
    }

    #[test]
    fn a_font_is_one_of_the_list() {
        for slot in ["body", "heading", "frame"] {
            let pointer = format!("/fonts/{slot}");
            for font in Font::ALL {
                assert!(validate_config(&set(base(), &pointer, json!(font.name()))).is_ok());
            }
            for bad in [
                json!("Arial"),
                json!(""),
                json!("ubuntu"),
                json!("Ubuntu "),
                json!(3),
                json!(null),
            ] {
                let found = expect(&set(base(), &pointer, bad), &pointer, "unknown_font");
                assert_eq!(found.name.as_deref(), Some(slot));
            }
            expect(&remove(base(), &pointer), &pointer, "missing_member");
        }
    }

    #[test]
    fn the_bullet_marker_is_bullet_or_dash() {
        for ok in ["bullet", "dash"] {
            assert!(validate_config(&set(base(), "/look/bulletMarker", json!(ok))).is_ok());
        }
        expect(
            &set(base(), "/look/bulletMarker", json!("star")),
            "/look/bulletMarker",
            "out_of_range",
        );
    }

    #[test]
    fn valign_and_position_are_from_their_sets() {
        for ok in ["top", "bottom"] {
            assert!(
                validate_config(&set(base(), "/variants/default/header/valign", json!(ok))).is_ok()
            );
        }
        expect(
            &set(base(), "/variants/default/footer/valign", json!("middle")),
            "/variants/default/footer/valign",
            "out_of_range",
        );
        for ok in ["left", "center", "right"] {
            assert!(
                validate_config(&set(rich(), "/variants/first/logo/position", json!(ok))).is_ok()
            );
        }
        expect(
            &set(rich(), "/variants/first/logo/position", json!("middle")),
            "/variants/first/logo/position",
            "out_of_range",
        );
    }

    #[test]
    fn an_asset_id_is_a_uuid() {
        for bad in [
            "",
            "logo.png",
            "0b9a3f0e5d2c4b8e9a431c2d3e4f5a6b",
            "0b9a3f0e-5d2c-4b8e-9a43-1c2d3e4f5a6",
            "zzzzzzzz-5d2c-4b8e-9a43-1c2d3e4f5a6b",
            "../img/0",
        ] {
            expect(
                &set(rich(), "/variants/first/logo/asset", json!(bad)),
                "/variants/first/logo/asset",
                "asset_unknown",
            );
            expect(
                &set(rich(), "/variants/first/background", json!(bad)),
                "/variants/first/background",
                "asset_unknown",
            );
        }
        expect(
            &set(rich(), "/variants/first/background", json!(5)),
            "/variants/first/background",
            "asset_unknown",
        );
        // null is "none"
        assert!(validate_config(&set(rich(), "/variants/first/background", Value::Null)).is_ok());
        assert!(validate_config(&set(rich(), "/variants/first/logo", Value::Null)).is_ok());
        expect(
            &remove(rich(), "/variants/first/logo/asset"),
            "/variants/first/logo/asset",
            "missing_member",
        );
    }
}

mod texts {
    use super::*;

    const IT: &str = "/variants/default/footer/left/0/text/it";
    const EN: &str = "/variants/default/footer/left/0/text/en";

    fn texts(it: &str, en: &str) -> Value {
        set(
            base(),
            "/variants/default/footer/left/0/text",
            json!({ "it": it, "en": en }),
        )
    }

    #[test]
    fn every_placeholder_of_the_closed_set_is_accepted() {
        let names: Vec<&str> = Placeholder::ALL.iter().map(|p| p.name()).collect();
        assert_eq!(
            names,
            [
                "legal_name",
                "address",
                "vat",
                "iban",
                "contacts",
                "page",
                "pages"
            ]
        );
        for name in names {
            let text = format!("x {{{name}}} y");
            assert!(validate_config(&texts(&text, &text)).is_ok(), "{name}");
        }
    }

    #[test]
    fn an_unknown_placeholder_is_refused_naming_it_and_its_text_and_language() {
        for bad in [
            "{foo}",
            "{Page}",
            "{ page }",
            "{}",
            "{legal-name}",
            "{page }",
            "{deal}",
        ] {
            let found = expect(&texts(bad, "ok"), IT, "unknown_placeholder");
            assert_eq!(found.name.as_deref(), Some(&bad[1..bad.len() - 1]));
            assert_eq!(found.language, Some(Language::It));
            let found = expect(&texts("ok", bad), EN, "unknown_placeholder");
            assert_eq!(found.language, Some(Language::En));
        }
        // both languages wrong: both are listed
        let both = pairs(&texts("{a}", "{b}"));
        assert_eq!(
            both,
            [
                (IT.to_owned(), "unknown_placeholder"),
                (EN.into(), "unknown_placeholder")
            ]
        );
    }

    #[test]
    fn the_name_of_a_problem_is_cut_to_a_bounded_length() {
        let long = format!("{{{}}}", "x".repeat(500));
        let found = expect(&texts(&long, "ok"), IT, "unknown_placeholder");
        assert_eq!(found.name.expect("name").chars().count(), MAX_NAME_CHARS);
        assert_eq!(MAX_NAME_CHARS, 40);
    }

    #[test]
    fn unbalanced_braces_are_refused() {
        for (bad, name) in [
            ("{page", "{"),
            ("page}", "}"),
            ("{", "{"),
            ("}", "}"),
            ("}}}", "}"),
            ("{{{page", "{"),
            ("a { b", "{"),
        ] {
            let found = expect(&texts(bad, "ok"), IT, "unbalanced_brace");
            assert_eq!(found.name.as_deref(), Some(name), "{bad}");
        }
    }

    #[test]
    fn a_text_is_filled_in_both_languages_or_in_neither() {
        let found = expect(&texts("Pagina {page}", ""), EN, "language_missing");
        assert_eq!(found.language, Some(Language::En));
        let found = expect(&texts("", "Page {page}"), IT, "language_missing");
        assert_eq!(found.language, Some(Language::It));
        // spaces are empty
        expect(&texts("x", "   \t"), EN, "language_missing");
        // neither: a blank line is allowed
        assert!(validate_config(&texts("", "")).is_ok());
        assert!(validate_config(&texts(" ", "")).is_ok());
        assert!(validate_config(&texts("a", "b")).is_ok());
    }

    #[test]
    fn language_completeness_holds_in_every_variant_and_frame() {
        for variant in ["first", "last"] {
            for (frame, zone) in [("header", "right"), ("footer", "center")] {
                let line = json!({ "text": { "it": "solo italiano", "en": "" }, "size": 8, "bold": false, "color": "000000" });
                let pointer = format!("/variants/{variant}/{frame}/{zone}");
                let value = set(rich(), &pointer, json!([line]));
                expect(&value, &format!("{pointer}/0/text/en"), "language_missing");
            }
        }
    }

    #[test]
    fn a_missing_language_member_is_reported_where_it_should_be() {
        let value = remove(base(), "/variants/default/footer/left/0/text/en");
        expect(&value, EN, "missing_member");
    }

    #[test]
    fn literal_braces_and_brackets_are_accepted() {
        for text in [
            "{{legal_name}}",
            "[[x]]",
            "a {{ b }} c [[ d ]]",
            "{{{page}}}",
            "[[ [{page}] ]]",
        ] {
            assert!(validate_config(&texts(text, text)).is_ok(), "{text}");
        }
    }

    #[test]
    fn segments_are_checked_at_save() {
        // a segment with a placeholder is fine, with every kind of placeholder
        for ok in [
            "[VAT: {vat}]",
            "[{vat} {iban}]",
            "[Pagina {page}]",
            "a [b {legal_name}] c [d {iban}] e",
        ] {
            assert!(validate_config(&texts(ok, ok)).is_ok(), "{ok}");
        }
        for bad in ["[no placeholder]", "[]", "[ ]", "x [text] y"] {
            let found = expect(&texts(bad, "ok"), IT, "segment_no_placeholder");
            assert_eq!(found.language, Some(Language::It));
        }
        for bad in ["[a [b {vat}]]", "[{vat} [x] ]", "[{vat} [b]"] {
            expect(&texts(bad, "ok"), IT, "segment_nested");
        }
        for (bad, name) in [
            ("[{vat}", "["),
            ("{vat}]", "]"),
            ("]", "]"),
            ("[ {vat} [[", "["),
        ] {
            let found = expect(&texts(bad, "ok"), IT, "unbalanced_bracket");
            assert_eq!(found.name.as_deref(), Some(name), "{bad}");
        }
        // an unknown placeholder inside a segment is still unknown
        expect(&texts("[x {nope}]", "ok"), IT, "unknown_placeholder");
    }
}

mod parser {
    use super::*;

    fn lit(text: &str) -> Token {
        Token::Literal(text.to_owned())
    }

    fn ph(placeholder: Placeholder) -> Token {
        Token::Placeholder(placeholder)
    }

    #[test]
    fn plain_text_is_one_literal_and_nothing_is_nothing() {
        assert_eq!(parse_text("hello, world"), Ok(vec![lit("hello, world")]));
        assert_eq!(parse_text(""), Ok(vec![]));
        assert_eq!(parse_text("à € 漢 😀"), Ok(vec![lit("à € 漢 😀")]));
    }

    #[test]
    fn placeholders_split_the_literals() {
        assert_eq!(
            parse_text("Pagina {page} di {pages}"),
            Ok(vec![
                lit("Pagina "),
                ph(Placeholder::Page),
                lit(" di "),
                ph(Placeholder::Pages)
            ])
        );
        assert_eq!(
            parse_text("{legal_name}{address}"),
            Ok(vec![ph(Placeholder::LegalName), ph(Placeholder::Address)])
        );
    }

    #[test]
    fn each_escape_prints_one_character() {
        assert_eq!(parse_text("{{"), Ok(vec![lit("{")]));
        assert_eq!(parse_text("}}"), Ok(vec![lit("}")]));
        assert_eq!(parse_text("[["), Ok(vec![lit("[")]));
        assert_eq!(parse_text("]]"), Ok(vec![lit("]")]));
        assert_eq!(parse_text("{{legal_name}}"), Ok(vec![lit("{legal_name}")]));
        assert_eq!(parse_text("[[x]]"), Ok(vec![lit("[x]")]));
        assert_eq!(
            parse_text("{{{page}}}"),
            Ok(vec![lit("{"), ph(Placeholder::Page), lit("}")])
        );
        assert_eq!(parse_text("{{ {{ }} }}"), Ok(vec![lit("{ { } }")]));
    }

    #[test]
    fn a_segment_holds_literals_and_placeholders() {
        assert_eq!(
            parse_text("a [VAT: {vat}] b"),
            Ok(vec![
                lit("a "),
                Token::Segment(vec![lit("VAT: "), ph(Placeholder::Vat)]),
                lit(" b")
            ])
        );
        // escapes work inside a segment
        assert_eq!(
            parse_text("[a [[b]] {vat}]"),
            Ok(vec![Token::Segment(vec![
                lit("a [b] "),
                ph(Placeholder::Vat)
            ])])
        );
    }

    #[test]
    fn the_pairs_are_taken_left_to_right() {
        // `]]` right after a segment is a literal bracket, so the segment is not closed: write `] ]`.
        let error = parse_text("[{vat}]]").expect_err("refused");
        assert_eq!(error.reason, Reason::UnbalancedBracket);
        assert_eq!(error.name.as_deref(), Some("["));
        assert_eq!(
            parse_text("[{vat}] ]]"),
            Ok(vec![Token::Segment(vec![ph(Placeholder::Vat)]), lit(" ]")])
        );
        // and a lone bracket is a fault
        assert_eq!(
            parse_text("[{vat}] ]").expect_err("refused").reason,
            Reason::UnbalancedBracket
        );
    }

    #[test]
    fn the_first_fault_is_the_one_reported() {
        assert_eq!(
            parse_text("{nope} }").expect_err("x").reason,
            Reason::UnknownPlaceholder
        );
        assert_eq!(
            parse_text("} {nope}").expect_err("x").reason,
            Reason::UnbalancedBrace
        );
    }

    #[test]
    fn placeholder_kinds() {
        assert!(Placeholder::Page.is_page() && Placeholder::Pages.is_page());
        for p in [
            Placeholder::LegalName,
            Placeholder::Address,
            Placeholder::Vat,
            Placeholder::Iban,
            Placeholder::Contacts,
        ] {
            assert!(!p.is_page());
            assert_eq!(Placeholder::parse(p.name()), Some(p));
        }
    }
}

mod reasons {
    use super::*;

    #[test]
    fn the_vocabulary_is_eighteen_reasons() {
        let names: Vec<&str> = Reason::ALL.iter().map(|r| r.as_str()).collect();
        assert_eq!(
            names,
            [
                "out_of_range",
                "not_a_number",
                "bad_colour",
                "unknown_font",
                "unknown_placeholder",
                "unbalanced_brace",
                "unbalanced_bracket",
                "segment_no_placeholder",
                "segment_nested",
                "too_many_lines",
                "language_missing",
                "body_too_small",
                "header_overflow",
                "footer_overflow",
                "asset_unknown",
                "wrong_type",
                "missing_member",
                "unknown_member",
            ]
        );
        for reason in Reason::ALL {
            assert_eq!(
                serde_json::to_value(reason).expect("json"),
                json!(reason.as_str())
            );
        }
    }

    #[test]
    fn a_problem_serialises_with_only_the_members_it_has() {
        let problem = Problem {
            path: "/margins/left".into(),
            reason: Reason::OutOfRange,
            name: None,
            language: None,
        };
        assert_eq!(
            serde_json::to_value(&problem).expect("json"),
            json!({ "path": "/margins/left", "reason": "out_of_range" })
        );
        let problem = Problem {
            path: "/a".into(),
            reason: Reason::UnknownPlaceholder,
            name: Some("foo".into()),
            language: Some(Language::En),
        };
        assert_eq!(
            serde_json::to_value(&problem).expect("json"),
            json!({ "path": "/a", "reason": "unknown_placeholder", "name": "foo", "language": "en" })
        );
    }

    /// Each reason that a save can raise is produced by some input; the two the layout raises (T5) and the
    /// one the save route raises for an id that is not an asset (T15) are not.
    #[test]
    fn every_reason_the_validator_can_raise_is_raised() {
        let cases: Vec<(Value, Reason)> = vec![
            (set(base(), "/margins/top", json!(1)), Reason::OutOfRange),
            (set(base(), "/margins/top", json!("a")), Reason::NotANumber),
            (
                set(base(), "/look/table/headerFill", json!("x")),
                Reason::BadColour,
            ),
            (set(base(), "/fonts/body", json!("x")), Reason::UnknownFont),
            (
                set(
                    base(),
                    "/variants/default/footer/left/0/text",
                    json!({"it":"{x}","en":"{x}"}),
                ),
                Reason::UnknownPlaceholder,
            ),
            (
                set(
                    base(),
                    "/variants/default/footer/left/0/text",
                    json!({"it":"{","en":"{"}),
                ),
                Reason::UnbalancedBrace,
            ),
            (
                set(
                    base(),
                    "/variants/default/footer/left/0/text",
                    json!({"it":"[a]","en":"[a]"}),
                ),
                Reason::SegmentNoPlaceholder,
            ),
            (
                set(
                    base(),
                    "/variants/default/footer/left/0/text",
                    json!({"it":"[[{vat}]","en":"ok"}),
                ),
                Reason::UnbalancedBracket,
            ),
            (
                set(
                    base(),
                    "/variants/default/footer/left/0/text",
                    json!({"it":"[a [{vat}]]","en":"ok"}),
                ),
                Reason::SegmentNested,
            ),
            (
                set(
                    base(),
                    "/variants/default/footer/left",
                    json!([1, 2, 3, 4, 5]),
                ),
                Reason::TooManyLines,
            ),
            (
                set(
                    base(),
                    "/variants/default/footer/left/0/text",
                    json!({"it":"a","en":""}),
                ),
                Reason::LanguageMissing,
            ),
            (
                set(
                    base(),
                    "/margins",
                    json!({"top":25,"bottom":25,"left":60,"right":60}),
                ),
                Reason::BodyTooSmall,
            ),
            (
                set(rich(), "/variants/first/background", json!("x")),
                Reason::AssetUnknown,
            ),
            (
                set(base(), "/look/headings/0/bold", json!(1)),
                Reason::WrongType,
            ),
            (remove(base(), "/margins/top"), Reason::MissingMember),
            (
                {
                    let mut v = base();
                    v["margins"]["x"] = json!(1);
                    v
                },
                Reason::UnknownMember,
            ),
        ];
        let mut raised = std::collections::HashSet::new();
        for (value, reason) in cases {
            let found = problems(&value);
            assert!(
                found.iter().any(|p| p.reason == reason),
                "{reason:?}: {found:?}"
            );
            raised.insert(reason);
        }
        for reason in Reason::ALL {
            let by_layout_or_route =
                matches!(reason, Reason::HeaderOverflow | Reason::FooterOverflow);
            assert_eq!(raised.contains(&reason), !by_layout_or_route, "{reason:?}");
        }
    }
}

/// One test per reason of the closed list of eighteen (amendment 2026-11-17, item 1): the input that
/// raises it, the path and the `name` it carries.
mod each_reason {
    use super::*;

    const FOOTER: &str = "/variants/default/footer/left/0/text";

    fn footer(it: &str) -> Value {
        set(base(), FOOTER, json!({ "it": it, "en": it }))
    }

    /// The problems of `value` that have `reason`, as (path, name).
    fn raised(value: &Value, reason: Reason) -> Vec<(String, Option<String>)> {
        problems(value)
            .into_iter()
            .filter(|p| p.reason == reason)
            .map(|p| (p.path, p.name))
            .collect()
    }

    fn footer_problem(it: &str, reason: Reason) -> Option<String> {
        let found = raised(&footer(it), reason);
        assert!(!found.is_empty(), "{it}: {reason:?}");
        assert_eq!(found[0].0, format!("{FOOTER}/it"), "{it}");
        found[0].1.clone()
    }

    #[test]
    fn the_list_has_eighteen_distinct_reasons() {
        let names: std::collections::HashSet<&str> =
            Reason::ALL.iter().map(|r| r.as_str()).collect();
        assert_eq!((Reason::ALL.len(), names.len()), (18, 18));
    }

    #[test]
    fn out_of_range() {
        let found = raised(&set(base(), "/margins/top", json!(1)), Reason::OutOfRange);
        assert_eq!(found[0].0, "/margins/top");
    }

    #[test]
    fn not_a_number() {
        let found = raised(&set(base(), "/margins/top", json!("a")), Reason::NotANumber);
        assert_eq!(found[0].0, "/margins/top");
    }

    #[test]
    fn bad_colour() {
        let found = raised(
            &set(base(), "/look/table/headerFill", json!("x")),
            Reason::BadColour,
        );
        assert_eq!(found[0].0, "/look/table/headerFill");
    }

    #[test]
    fn unknown_font() {
        let found = raised(&set(base(), "/fonts/body", json!("x")), Reason::UnknownFont);
        assert_eq!(found[0].0, "/fonts/body");
    }

    #[test]
    fn unknown_placeholder() {
        let name = footer_problem("{nope}", Reason::UnknownPlaceholder);
        assert_eq!(name.as_deref(), Some("nope"));
    }

    #[test]
    fn unbalanced_brace_for_an_open_brace() {
        let name = footer_problem("{page", Reason::UnbalancedBrace);
        assert_eq!(name.as_deref(), Some("{"));
    }

    #[test]
    fn unbalanced_brace_for_a_closing_brace() {
        let name = footer_problem("page}", Reason::UnbalancedBrace);
        assert_eq!(name.as_deref(), Some("}"));
    }

    #[test]
    fn unbalanced_bracket_for_an_unclosed_open_bracket() {
        let name = footer_problem("[{vat}", Reason::UnbalancedBracket);
        assert_eq!(name.as_deref(), Some("["));
        // and it is no longer reported as a brace
        assert!(raised(&footer("[{vat}"), Reason::UnbalancedBrace).is_empty());
    }

    #[test]
    fn unbalanced_bracket_for_a_stray_closing_bracket() {
        let name = footer_problem("{vat}]", Reason::UnbalancedBracket);
        assert_eq!(name.as_deref(), Some("]"));
        assert!(raised(&footer("{vat}]"), Reason::UnbalancedBrace).is_empty());
    }

    #[test]
    fn a_brace_is_never_reported_as_a_bracket() {
        for bad in ["{", "}", "{page", "page}"] {
            assert!(
                raised(&footer(bad), Reason::UnbalancedBracket).is_empty(),
                "{bad}"
            );
        }
    }

    #[test]
    fn segment_no_placeholder() {
        let name = footer_problem("[a]", Reason::SegmentNoPlaceholder);
        assert_eq!(name, None);
    }

    #[test]
    fn segment_nested() {
        let name = footer_problem("[a [{vat}]]", Reason::SegmentNested);
        assert_eq!(name, None);
    }

    #[test]
    fn too_many_lines() {
        let found = raised(
            &set(
                base(),
                "/variants/default/footer/left",
                json!([1, 2, 3, 4, 5]),
            ),
            Reason::TooManyLines,
        );
        assert!(!found.is_empty());
    }

    #[test]
    fn language_missing() {
        let found = raised(
            &set(base(), FOOTER, json!({"it": "a", "en": ""})),
            Reason::LanguageMissing,
        );
        assert_eq!(found[0].0, format!("{FOOTER}/en"));
    }

    #[test]
    fn body_too_small() {
        let value = set(
            base(),
            "/margins",
            json!({"top":25,"bottom":25,"left":60,"right":60}),
        );
        assert!(!raised(&value, Reason::BodyTooSmall).is_empty());
    }

    /// Found by the layout when it measures a frame (T5), never by `validate_config`: the reason is in the
    /// list, spelled as the contract says, and serialises as a problem.
    #[test]
    fn header_overflow() {
        assert_eq!(Reason::HeaderOverflow.as_str(), "header_overflow");
        assert!(Reason::ALL.contains(&Reason::HeaderOverflow));
        assert_eq!(
            serde_json::to_value(Reason::HeaderOverflow).expect("json"),
            json!("header_overflow")
        );
        assert!(validate_config(&base()).is_ok());
    }

    /// As `header_overflow`.
    #[test]
    fn footer_overflow() {
        assert_eq!(Reason::FooterOverflow.as_str(), "footer_overflow");
        assert!(Reason::ALL.contains(&Reason::FooterOverflow));
        assert_eq!(
            serde_json::to_value(Reason::FooterOverflow).expect("json"),
            json!("footer_overflow")
        );
    }

    #[test]
    fn asset_unknown() {
        let found = raised(
            &set(rich(), "/variants/first/background", json!("x")),
            Reason::AssetUnknown,
        );
        assert!(!found.is_empty());
    }

    #[test]
    fn wrong_type() {
        let found = raised(
            &set(base(), "/look/headings/0/bold", json!(1)),
            Reason::WrongType,
        );
        assert_eq!(found[0].0, "/look/headings/0/bold");
    }

    #[test]
    fn missing_member() {
        let found = raised(&remove(base(), "/margins/top"), Reason::MissingMember);
        assert_eq!(found[0].0, "/margins/top");
    }

    #[test]
    fn unknown_member() {
        let mut value = base();
        value["margins"]["x"] = json!(1);
        let found = raised(&value, Reason::UnknownMember);
        // points at the object that holds the member, and never echoes the key
        assert_eq!(found[0], ("/margins".to_owned(), None));
    }
}

mod diff {
    use super::*;

    fn changed(new: Value) -> Vec<&'static str> {
        changed_settings(&typed(&rich()), &typed(&new))
    }

    #[test]
    fn equal_configs_change_nothing() {
        assert!(changed_settings(&default_config(), &default_config()).is_empty());
        assert!(changed(rich()).is_empty());
    }

    #[test]
    fn each_setting_of_the_vocabulary_is_named_by_its_own_change() {
        let cases: Vec<(&str, Value)> = vec![
            ("margins", set(rich(), "/margins/left", json!(30))),
            ("fonts", set(rich(), "/fonts/body", json!("DM Sans"))),
            (
                "look.headings",
                set(rich(), "/look/headings/1/size", json!(13)),
            ),
            (
                "look.body",
                set(rich(), "/look/body/lineSpacing", json!(1.5)),
            ),
            (
                "look.table",
                set(rich(), "/look/table/borders", json!(false)),
            ),
            (
                "look.bulletMarker",
                set(rich(), "/look/bulletMarker", json!("dash")),
            ),
            (
                "variants.default.header",
                set(rich(), "/variants/default/header/valign", json!("bottom")),
            ),
            (
                "variants.default.footer",
                set(rich(), "/variants/default/footer/left/0/size", json!(9.5)),
            ),
            (
                "variants.default.logo",
                set(
                    rich(),
                    "/variants/default/logo",
                    json!({"asset": LOGO_ID, "position": "right", "heightMm": 8}),
                ),
            ),
            (
                "variants.default.background",
                set(rich(), "/variants/default/background", json!(BG_ID)),
            ),
            (
                "variants.first.header",
                set(rich(), "/variants/first/header/rule/show", json!(true)),
            ),
            (
                "variants.first.footer",
                set(rich(), "/variants/first/footer/rule/color", json!("000000")),
            ),
            (
                "variants.first.logo",
                set(rich(), "/variants/first/logo/heightMm", json!(20)),
            ),
            (
                "variants.first.background",
                set(rich(), "/variants/first/background", Value::Null),
            ),
            (
                "variants.last.header",
                set(rich(), "/variants/last/header/rule/thicknessPt", json!(2)),
            ),
            (
                "variants.last.footer",
                set(
                    rich(),
                    "/variants/last/footer/left/0/text/en",
                    json!("Done"),
                ),
            ),
            (
                "variants.last.logo",
                set(
                    rich(),
                    "/variants/last/logo",
                    json!({"asset": LOGO_ID, "position": "left", "heightMm": 8}),
                ),
            ),
            (
                "variants.last.background",
                set(rich(), "/variants/last/background", json!(BG_ID)),
            ),
            (
                "variants.first",
                set(rich(), "/variants/first", Value::Null),
            ),
            ("variants.last", set(rich(), "/variants/last", Value::Null)),
        ];
        let mut seen = Vec::new();
        for (name, value) in cases {
            assert_eq!(changed(value), [name], "{name}");
            seen.push(name);
        }
        let mut vocabulary: Vec<&str> = SETTING_NAMES.to_vec();
        seen.sort_unstable();
        vocabulary.sort_unstable();
        assert_eq!(seen, vocabulary, "a test per name");
    }

    #[test]
    fn the_document_title_is_set_beside_the_headings_in_the_same_name() {
        for pointer in ["/look/title/color", "/look/title/size", "/look/title/bold"] {
            let value = match pointer {
                "/look/title/color" => json!("e50339"),
                "/look/title/size" => json!(30),
                _ => json!(false),
            };
            assert_eq!(changed(set(rich(), pointer, value)), ["look.headings"]);
        }
    }

    #[test]
    fn switching_a_variant_on_is_one_name_not_its_parts() {
        let old = typed(&base());
        let new = typed(&rich());
        assert_eq!(
            changed_settings(&old, &new),
            ["variants.first", "variants.last"]
        );
        assert_eq!(
            changed_settings(&new, &old),
            ["variants.first", "variants.last"]
        );
    }

    #[test]
    fn several_changes_come_in_vocabulary_order_and_never_twice() {
        let mut value = rich();
        value["variants"]["last"]["footer"]["rule"]["show"] = json!(false);
        value["margins"]["top"] = json!(30);
        value["look"]["bulletMarker"] = json!("dash");
        value["variants"]["default"]["header"]["valign"] = json!("bottom");
        value["variants"]["first"]["background"] = Value::Null;
        let found = changed(value);
        assert_eq!(
            found,
            [
                "margins",
                "look.bulletMarker",
                "variants.default.header",
                "variants.first.background",
                "variants.last.footer"
            ]
        );
    }

    #[test]
    fn a_restore_of_an_older_config_names_what_differs_from_the_active_one() {
        let v2 = typed(&base());
        let v4 = typed(&set(base(), "/fonts/heading", json!("Syne")));
        assert_eq!(changed_settings(&v4, &v2), ["fonts"]);
    }

    #[test]
    fn only_vocabulary_names_are_ever_returned() {
        // Change every value, one at a time, of the rich config, and check the names.
        let original = rich();
        let pointers = collect_pointers(&original);
        assert!(pointers.len() > 60, "{}", pointers.len());
        let mut checked = 0;
        for pointer in pointers {
            let mut value = original.clone();
            let target = value.pointer_mut(&pointer).expect("pointer");
            match target {
                Value::Number(n) => {
                    // stay within the bounds: nudge toward the middle of any range
                    let x = n.as_f64().expect("f64");
                    *target = json!(if x > 12.0 { x - 1.0 } else { x + 0.5 });
                }
                Value::Bool(flag) => *flag = !*flag,
                Value::String(text) => {
                    *text = match pointer.as_str() {
                        p if p.ends_with("/color")
                            || p.ends_with("headerFill")
                            || p.ends_with("borderColor") =>
                        {
                            "123456".into()
                        }
                        p if p.ends_with("/asset") || p.ends_with("/background") => {
                            "11111111-2222-4333-8444-555555555555".into()
                        }
                        p if p.starts_with("/fonts/") => "Syne".into(),
                        p if p.ends_with("bulletMarker") => {
                            if text == "dash" {
                                "bullet".into()
                            } else {
                                "dash".into()
                            }
                        }
                        p if p.ends_with("valign") => {
                            if text == "top" {
                                "bottom".into()
                            } else {
                                "top".into()
                            }
                        }
                        p if p.ends_with("position") => "right".into(),
                        _ => format!("{text}!"),
                    };
                }
                _ => continue,
            }
            let Ok(new) = validate_config(&value) else {
                continue;
            };
            checked += 1;
            let names = changed_settings(&typed(&original), &new);
            assert!(!names.is_empty(), "{pointer} changed nothing?");
            for name in &names {
                assert!(SETTING_NAMES.contains(name), "{pointer} -> {name}");
            }
            let mut unique = names.clone();
            unique.dedup();
            assert_eq!(unique, names);
        }
        assert!(
            checked > 60,
            "only {checked} single-value changes were valid"
        );
    }

    fn collect_pointers(value: &Value) -> Vec<String> {
        fn walk(value: &Value, here: String, out: &mut Vec<String>) {
            match value {
                Value::Object(map) => map
                    .iter()
                    .for_each(|(k, v)| walk(v, format!("{here}/{k}"), out)),
                Value::Array(items) => items
                    .iter()
                    .enumerate()
                    .for_each(|(i, v)| walk(v, format!("{here}/{i}"), out)),
                _ => out.push(here),
            }
        }
        let mut out = Vec::new();
        walk(value, String::new(), &mut out);
        out
    }

    #[test]
    fn the_first_save_names_everything_it_sets() {
        let names = initial_settings(&typed(&base()));
        assert_eq!(names.len(), 10);
        assert!(names.iter().all(|n| SETTING_NAMES.contains(n)));
        let names = initial_settings(&typed(&rich()));
        assert_eq!(&names[10..], ["variants.first", "variants.last"]);
    }

    #[test]
    fn the_vocabulary_has_no_values_and_no_duplicates() {
        let mut names = SETTING_NAMES.to_vec();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), SETTING_NAMES.len());
        assert_eq!(SETTING_NAMES.len(), 8 + 12);
    }
}

mod frame_gap {
    use super::*;

    /// A configuration stored before `gapMm` existed: no frame has the member.
    fn stored_before() -> Value {
        let mut value = rich();
        for variant in ["default", "first", "last"] {
            for frame in ["header", "footer"] {
                value["variants"][variant][frame]
                    .as_object_mut()
                    .expect("a frame")
                    .remove("gapMm")
                    .expect("the member is there to remove");
            }
        }
        value
    }

    #[test]
    fn the_starting_configuration_says_3_mm_in_every_frame() {
        let value = base();
        assert_eq!(value["variants"]["default"]["header"]["gapMm"], json!(3.0));
        assert_eq!(value["variants"]["default"]["footer"]["gapMm"], json!(3.0));
        assert_eq!(default_config().variants.default.header.gap_mm, 3.0);
    }

    #[test]
    fn a_configuration_without_the_member_validates_and_has_3_mm() {
        let config = validate_config(&stored_before()).expect("a stored v1 stays valid");
        for variant in [
            Some(&config.variants.default),
            config.variants.first.as_ref(),
            config.variants.last.as_ref(),
        ] {
            let variant = variant.expect("rich has all three");
            assert_eq!(variant.header.gap_mm, 3.0);
            assert_eq!(variant.footer.gap_mm, 3.0);
        }
    }

    #[test]
    fn a_stored_configuration_read_back_without_the_member_has_3_mm() {
        // The store reads a version back with serde, not with the validator.
        let config: LetterheadConfig = serde_json::from_value(stored_before()).expect("reads back");
        assert_eq!(config.variants.default.header.gap_mm, 3.0);
        assert_eq!(config.variants.first.expect("first").footer.gap_mm, 3.0);
        // And it is the same configuration as one that says 3 mm.
        assert_eq!(
            validate_config(&stored_before()).expect("valid"),
            validate_config(&rich()).expect("valid")
        );
    }

    #[test]
    fn a_distance_is_kept_per_frame() {
        let mut value = set(base(), "/variants/default/header/gapMm", json!(12.5));
        value = set(value, "/variants/default/footer/gapMm", json!(0));
        let config = validate_config(&value).expect("valid");
        assert_eq!(config.variants.default.header.gap_mm, 12.5);
        assert_eq!(config.variants.default.footer.gap_mm, 0.0);
        // Round trip through JSON.
        let back: LetterheadConfig =
            serde_json::from_value(serde_json::to_value(&config).expect("json")).expect("back");
        assert_eq!(back, config);
    }

    #[test]
    fn a_misspelt_distance_is_an_unknown_member() {
        let mut value = base();
        value["variants"]["default"]["header"]["gap"] = json!(5);
        assert_eq!(
            pairs(&value),
            [("/variants/default/header".into(), "unknown_member")]
        );
    }
}

mod document_title {
    use super::*;

    /// A configuration stored before `look.title` existed.
    fn stored_before() -> Value {
        remove(rich(), "/look/title")
    }

    #[test]
    fn the_starting_configuration_says_20_pt_bold_black() {
        let value = base();
        assert_eq!(
            value["look"]["title"],
            json!({ "size": 20.0, "bold": true, "color": "000000" })
        );
        let title = default_config().look.title;
        assert_eq!(
            (title.size, title.bold, title.color.as_str()),
            (20.0, true, "000000")
        );
        assert_eq!(default_title_look(), title);
    }

    #[test]
    fn a_configuration_without_the_member_validates_and_has_the_default_title() {
        let config = validate_config(&stored_before()).expect("a stored v1 stays valid");
        assert_eq!(config.look.title, default_title_look());
        assert_eq!(config, validate_config(&rich()).expect("valid"));
    }

    #[test]
    fn a_stored_configuration_read_back_without_the_member_has_the_default_title() {
        // The store reads a version back with serde, not with the validator.
        let config: LetterheadConfig = serde_json::from_value(stored_before()).expect("reads back");
        assert_eq!(config.look.title, default_title_look());
        // And it is written back with the member, so a new save says what it renders.
        let written = serde_json::to_value(&config).expect("json");
        assert_eq!(written["look"]["title"]["size"], json!(20.0));
    }

    #[test]
    fn a_configured_title_is_kept_and_its_colour_is_lower_case() {
        let value = set(
            rich(),
            "/look/title",
            json!({ "size": 28.5, "bold": false, "color": "E50339" }),
        );
        let config = validate_config(&value).expect("valid");
        assert_eq!(config.look.title.size, 28.5);
        assert!(!config.look.title.bold);
        assert_eq!(config.look.title.color, "e50339");
        let back: LetterheadConfig =
            serde_json::from_value(serde_json::to_value(&config).expect("json")).expect("back");
        assert_eq!(back, config);
    }

    #[test]
    fn a_bad_title_names_its_member() {
        let value = set(base(), "/look/title/color", json!("red"));
        expect(&value, "/look/title/color", "bad_colour");
        let value = set(base(), "/look/title/bold", json!("yes"));
        expect(&value, "/look/title/bold", "wrong_type");
        let value = remove(base(), "/look/title/size");
        expect(&value, "/look/title/size", "missing_member");
        let mut value = base();
        value["look"]["title"]["font"] = json!("Syne");
        assert_eq!(
            pairs(&value),
            [("/look/title".into(), "unknown_member")],
            "the font of the title is the heading font, not a setting"
        );
        let value = set(base(), "/look/title", json!(20));
        expect(&value, "/look/title", "wrong_type");
    }

    #[test]
    fn a_title_problem_does_not_hide_the_others() {
        let mut value = set(base(), "/look/title/size", json!(99));
        value = set(value, "/look/title/color", json!("nope"));
        value = set(value, "/look/headings/0/size", json!(1));
        let mut found = pairs(&value);
        found.sort();
        assert_eq!(
            found,
            [
                ("/look/headings/0/size".into(), "out_of_range"),
                ("/look/title/color".into(), "bad_colour"),
                ("/look/title/size".into(), "out_of_range"),
            ]
        );
    }
}
