//! Tests of asset ingestion (task T8). Run: `cargo test -p letterhead-engine assets::`.
//!
//! One fixture per reason, a corpus of clean files, properties of the rebuilt SVG, a no-panic fuzz, and
//! a Typst World that logs every file it is asked for (the check of AC-7.2: a clean SVG, rendered, reads
//! nothing but itself; and the same World reads a relative `href` when the SVG is not rebuilt, so the check
//! can fail).

use super::raster::crc32;
use super::*;

// A real PNG (2 x 1, RGB, made with zlib): checks the checksum code against an independent implementation.
const REAL_PNG: [u8; 70] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x7b, 0x40, 0xe8,
    0xdd, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0x00, 0x04,
    0xff, 0x01, 0x07, 0x00, 0x01, 0xff, 0xe2, 0x23, 0x9e, 0x59, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = (body.len() as u32).to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
    out.extend_from_slice(&crc32(&[kind, body]).to_be_bytes());
    out
}

fn ihdr(width: u32, height: u32, depth: u8, colour: u8, interlace: u8) -> Vec<u8> {
    let mut body = width.to_be_bytes().to_vec();
    body.extend_from_slice(&height.to_be_bytes());
    body.extend_from_slice(&[depth, colour, 0, 0, interlace]);
    chunk(b"IHDR", &body)
}

/// A PNG whose container is sound, whatever its pixels: the walker reads the container only.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = REAL_PNG[..8].to_vec();
    out.extend(ihdr(width, height, 8, 2, 0));
    out.extend(chunk(b"IDAT", b"not really zlib"));
    out.extend(chunk(b"IEND", b""));
    out
}

fn segment(code: u8, body: &[u8]) -> Vec<u8> {
    let mut out = vec![0xFF, code];
    out.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(body);
    out
}

fn sof(code: u8, width: u16, height: u16) -> Vec<u8> {
    let mut body = vec![8];
    body.extend_from_slice(&height.to_be_bytes());
    body.extend_from_slice(&width.to_be_bytes());
    body.extend_from_slice(&[1, 1, 0x11, 0]);
    segment(code, &body)
}

/// A JPEG whose segments are sound; its entropy-coded data holds stuffing and a restart marker.
fn jpeg_with(frames: &[Vec<u8>], eoi: bool) -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8];
    out.extend(segment(0xE0, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
    out.extend(segment(0xDB, &[0; 65]));
    for frame in frames {
        out.extend(frame);
    }
    out.extend(segment(0xC4, &[0; 20]));
    out.extend(segment(0xDA, &[1, 1, 0, 0, 63, 0]));
    out.extend_from_slice(&[0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56, 0xFF, 0xFF, 0x00]);
    if eoi {
        out.extend_from_slice(&[0xFF, 0xD9]);
    }
    out
}

fn jpeg(width: u16, height: u16) -> Vec<u8> {
    jpeg_with(&[sof(0xC0, width, height)], true)
}

fn svg(source: &str) -> Result<Ingested, Reason> {
    ingest(source.as_bytes())
}

fn svg_out(source: &str) -> String {
    let ingested = svg(source).unwrap_or_else(|r| panic!("{r:?} for {source}"));
    assert_eq!(ingested.format, Format::Svg);
    String::from_utf8(ingested.bytes).expect("utf-8")
}

fn refused(source: &str) -> Reason {
    svg(source).expect_err(source)
}

const NS: &str = "xmlns=\"http://www.w3.org/2000/svg\"";

fn wrap(inner: &str) -> String {
    format!("<svg {NS} viewBox=\"0 0 10 10\">{inner}</svg>")
}

mod formats {
    use super::*;

    #[test]
    fn the_checksum_is_the_pngs() {
        assert_eq!(crc32(&[b"123456789"]), 0xCBF4_3926);
        assert_eq!(crc32(&[b"1234", b"56789"]), 0xCBF4_3926);
    }

    #[test]
    fn a_png_is_a_png_by_its_bytes() {
        let got = ingest(&REAL_PNG).expect("real png");
        assert_eq!(
            (got.format, got.width, got.height),
            (Format::Png, Some(2), Some(1))
        );
        assert_eq!(got.bytes, REAL_PNG, "a raster is stored as it came");
        let got = ingest(&png(640, 480)).expect("synthetic png");
        assert_eq!((got.width, got.height), (Some(640), Some(480)));
    }

    #[test]
    fn a_jpeg_is_a_jpeg_by_its_bytes() {
        let bytes = jpeg(800, 600);
        let got = ingest(&bytes).expect("jpeg");
        assert_eq!(
            (got.format, got.width, got.height),
            (Format::Jpeg, Some(800), Some(600))
        );
        assert_eq!(got.bytes, bytes);
        // baseline, extended and progressive
        for code in [0xC0, 0xC1, 0xC2] {
            assert!(
                ingest(&jpeg_with(&[sof(code, 10, 10)], true)).is_ok(),
                "{code:x}"
            );
        }
    }

    #[test]
    fn an_svg_is_an_svg_by_its_text_and_has_no_size() {
        let got = svg(&wrap("<rect width=\"5\" height=\"5\"/>")).expect("svg");
        assert_eq!(
            (got.format, got.width, got.height),
            (Format::Svg, None, None)
        );
    }

    #[test]
    fn format_names_are_the_databases() {
        assert_eq!(
            [Format::Png, Format::Jpeg, Format::Svg].map(Format::as_str),
            ["png", "jpeg", "svg"]
        );
        assert_eq!(
            serde_json::to_string(&Format::Jpeg).expect("json"),
            "\"jpeg\""
        );
    }

    #[test]
    fn what_a_file_is_called_does_not_matter_only_its_bytes_do() {
        // AC-7.1: the service never sees a name; these are the cases the names would have lied about.
        let png_called_svg = png(10, 10);
        assert_eq!(ingest(&png_called_svg).expect("png").format, Format::Png);
        let pdf_called_png = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n".to_vec();
        assert_eq!(ingest(&pdf_called_png), Err(Reason::UnsupportedFormat));
        let svg_called_png = wrap("<rect/>").into_bytes();
        assert_eq!(ingest(&svg_called_png).expect("svg").format, Format::Svg);
        let jpeg_called_png = jpeg(5, 5);
        assert_eq!(ingest(&jpeg_called_png).expect("jpeg").format, Format::Jpeg);
    }
}

mod unsupported_format {
    use super::*;

    fn unsupported(bytes: &[u8]) {
        assert_eq!(ingest(bytes), Err(Reason::UnsupportedFormat), "{bytes:?}");
    }

    #[test]
    fn other_formats_and_text_are_refused() {
        for bytes in [
            &b""[..],
            b"hello",
            b"%PDF-1.7 ...",
            b"GIF89a\x01\x00\x01\x00",
            b"RIFF\x00\x00\x00\x00WEBPVP8 ",
            b"BM\x00\x00",
            b"PK\x03\x04",
            b"\x7fELF\x02\x01\x01",
            b"<html><body>hi</body></html>",
            b"<?xml version=\"1.0\"?><note>hi</note>",
            b"\xFF\xFE<\0s\0v\0g\0>\0", // UTF-16
            b"<svg \xFF\xFE>",          // not UTF-8
            b"   ",
            b"\0\0\0\0",
        ] {
            unsupported(bytes);
        }
    }

    #[test]
    fn a_damaged_png_is_refused() {
        let good = png(10, 10);
        // truncated anywhere
        for cut in [9, 20, 33, 40, good.len() - 13, good.len() - 1] {
            unsupported(&good[..cut]);
        }
        // a flipped byte in each region (chunk lengths, types, bodies, checksums)
        for at in (8..good.len()).step_by(3) {
            let mut bad = good.clone();
            bad[at] ^= 0x55;
            assert!(ingest(&bad).is_err(), "flip at {at}");
        }
        // without IEND, without IDAT, IHDR twice, IHDR not first, an empty IHDR
        let mut no_end = REAL_PNG[..8].to_vec();
        no_end.extend(ihdr(2, 2, 8, 2, 0));
        no_end.extend(chunk(b"IDAT", b"x"));
        unsupported(&no_end);
        let mut no_data = REAL_PNG[..8].to_vec();
        no_data.extend(ihdr(2, 2, 8, 2, 0));
        no_data.extend(chunk(b"IEND", b""));
        unsupported(&no_data);
        let mut twice = REAL_PNG[..8].to_vec();
        twice.extend(ihdr(2, 2, 8, 2, 0));
        twice.extend(ihdr(2, 2, 8, 2, 0));
        twice.extend(chunk(b"IDAT", b"x"));
        twice.extend(chunk(b"IEND", b""));
        unsupported(&twice);
        let mut late = REAL_PNG[..8].to_vec();
        late.extend(chunk(b"tEXt", b"a\0b"));
        late.extend(ihdr(2, 2, 8, 2, 0));
        late.extend(chunk(b"IDAT", b"x"));
        late.extend(chunk(b"IEND", b""));
        unsupported(&late);
        let mut short = REAL_PNG[..8].to_vec();
        short.extend(chunk(b"IHDR", b"short"));
        unsupported(&short);
    }

    #[test]
    fn a_png_header_that_says_nothing_valid_is_refused() {
        for (w, h, depth, colour, interlace) in [
            (0, 5, 8, 2, 0),
            (5, 0, 8, 2, 0),
            (5, 5, 7, 2, 0),
            (5, 5, 8, 1, 0),
            (5, 5, 16, 3, 0),
            (5, 5, 1, 2, 0),
            (5, 5, 8, 2, 2),
            (u32::MAX, 5, 8, 2, 0),
        ] {
            let mut bytes = REAL_PNG[..8].to_vec();
            bytes.extend(ihdr(w, h, depth, colour, interlace));
            bytes.extend(chunk(b"IDAT", b"x"));
            bytes.extend(chunk(b"IEND", b""));
            unsupported(&bytes);
        }
        // and the legal combinations are fine
        for (depth, colour) in [
            (1, 0),
            (16, 0),
            (8, 2),
            (16, 2),
            (1, 3),
            (8, 3),
            (8, 4),
            (16, 4),
            (8, 6),
            (16, 6),
        ] {
            let mut bytes = REAL_PNG[..8].to_vec();
            bytes.extend(ihdr(5, 5, depth, colour, 1));
            bytes.extend(chunk(b"IDAT", b"x"));
            bytes.extend(chunk(b"IEND", b""));
            assert!(ingest(&bytes).is_ok(), "{depth}/{colour}");
        }
    }

    #[test]
    fn a_damaged_or_unsupported_jpeg_is_refused() {
        let good = jpeg(10, 10);
        // truncated before EOI, and at the segments
        for cut in [3, 10, 30, good.len() - 2, good.len() - 1] {
            unsupported(&good[..cut]);
        }
        // no EOI
        unsupported(&jpeg_with(&[sof(0xC0, 10, 10)], false));
        // no frame header before the scan
        unsupported(&jpeg_with(&[], true));
        // two frame headers
        unsupported(&jpeg_with(&[sof(0xC0, 10, 10), sof(0xC2, 10, 10)], true));
        // lossless, arithmetic, differential: kinds the service does not take
        for code in [0xC3, 0xC5, 0xC9, 0xCA, 0xCF] {
            unsupported(&jpeg_with(&[sof(code, 10, 10)], true));
        }
        // zero size
        unsupported(&jpeg(0, 10));
        unsupported(&jpeg(10, 0));
        // a segment longer than the file, or shorter than its own length field
        let mut bad = good.clone();
        bad[4] = 0xFF;
        bad[5] = 0xFF;
        unsupported(&bad);
        let mut bad = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01];
        bad.extend_from_slice(&[0xFF, 0xD9]);
        unsupported(&bad);
        // garbage between segments before the scan
        let mut bad = good;
        bad.insert(2, 0x41);
        unsupported(&bad);
        // a second SOI
        unsupported(&[0xFF, 0xD8, 0xFF, 0xD8, 0xFF, 0xD9]);
    }

    #[test]
    fn broken_xml_and_documents_that_are_not_an_svg_are_refused() {
        for source in [
            "<svg",
            "<svg xmlns=\"http://www.w3.org/2000/svg\">",
            "<svg><g></svg>",
            "<svg></g></svg>",
            "<svg/><svg/>",
            "<svg/> trailing text",
            "<svg>&unknown;</svg>",
            "<svg a=\"&unknown;\"/>",
            "<svg>&#xD800;</svg>",
            "<svg>&#0;</svg>",
            "<svg><rect fill=\"red\" fill=\"blue\"/></svg>",
            "<svg><rect xlink:href=\"#a\" xlink:href=\"#a\"/></svg>",
            "<svg>&amp</svg>",
            "<svg width=5/>",
            "<g/>",
            "<svg:svg xmlns:svg=\"http://www.w3.org/2000/svg\"/>",
            "<rect xmlns=\"http://www.w3.org/2000/svg\"/>",
            "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><svg/>",
            "<!-- only a comment -->",
            "<",
        ] {
            assert_eq!(refused(source), Reason::UnsupportedFormat, "{source}");
        }
    }
}

mod limits {
    use super::*;

    /// An SVG of exactly `len` bytes, padded with a comment, which the rebuild drops.
    fn padded(len: usize) -> Vec<u8> {
        let head = format!("<svg {NS} viewBox=\"0 0 1 1\"><!--");
        let tail = "--></svg>";
        let fill = len - head.len() - tail.len();
        let mut out = head.into_bytes();
        out.extend(std::iter::repeat_n(b'x', fill));
        out.extend_from_slice(tail.as_bytes());
        out
    }

    #[test]
    fn two_mebibytes_are_accepted_and_one_more_byte_is_not() {
        assert_eq!(MAX_BYTES, 2_097_152);
        let at_limit = padded(MAX_BYTES);
        assert_eq!(at_limit.len(), MAX_BYTES);
        let got = ingest(&at_limit).expect("at the limit");
        assert!(got.bytes.len() < 200, "the padding is not kept");
        assert_eq!(ingest(&padded(MAX_BYTES + 1)), Err(Reason::TooManyBytes));
    }

    #[test]
    fn size_is_judged_before_the_format() {
        assert_eq!(ingest(&vec![0u8; MAX_BYTES + 1]), Err(Reason::TooManyBytes));
        let mut big_png = png(10, 10);
        big_png.resize(MAX_BYTES + 1, 0);
        assert_eq!(ingest(&big_png), Err(Reason::TooManyBytes));
    }

    #[test]
    fn twenty_five_megapixels_of_png_are_accepted_and_one_more_row_is_not() {
        assert_eq!(MAX_PIXELS, 25_000_000);
        assert!(ingest(&png(5_000, 5_000)).is_ok());
        assert!(ingest(&png(25_000_000, 1)).is_ok());
        assert_eq!(ingest(&png(5_001, 5_000)), Err(Reason::TooManyPixels));
        assert_eq!(ingest(&png(25_000_001, 1)), Err(Reason::TooManyPixels));
        assert_eq!(
            ingest(&png(0x7FFF_FFFF, 0x7FFF_FFFF)),
            Err(Reason::TooManyPixels)
        );
    }

    #[test]
    fn the_pixel_bound_is_judged_from_the_header_before_anything_else_is_read() {
        // A header that claims 100 000 x 100 000 and a file that is garbage after it: refused for its size,
        // not for being damaged; nothing past IHDR is read, and nothing is decoded.
        let mut bytes = REAL_PNG[..8].to_vec();
        bytes.extend(ihdr(100_000, 100_000, 8, 2, 0));
        bytes.extend_from_slice(b"garbage garbage garbage");
        assert_eq!(ingest(&bytes), Err(Reason::TooManyPixels));
    }

    #[test]
    fn twenty_five_megapixels_of_jpeg_are_accepted_and_more_are_not() {
        assert!(ingest(&jpeg(5_000, 5_000)).is_ok());
        assert_eq!(ingest(&jpeg(5_001, 5_000)), Err(Reason::TooManyPixels));
        assert_eq!(ingest(&jpeg(65_535, 65_535)), Err(Reason::TooManyPixels));
        // the header is read before the rest: a JPEG that stops after its frame header
        let mut cut = vec![0xFF, 0xD8];
        cut.extend(sof(0xC0, 30_000, 30_000));
        assert_eq!(ingest(&cut), Err(Reason::TooManyPixels));
    }

    #[test]
    fn a_second_frame_header_cannot_claim_another_size() {
        // The decoder would use one of the two; both can be seen, so neither can be a lie.
        assert_eq!(
            ingest(&jpeg_with(
                &[sof(0xC0, 10, 10), sof(0xC0, 20_000, 20_000)],
                true
            )),
            Err(Reason::UnsupportedFormat)
        );
        assert_eq!(
            ingest(&jpeg_with(
                &[sof(0xC0, 20_000, 20_000), sof(0xC0, 10, 10)],
                true
            )),
            Err(Reason::TooManyPixels)
        );
    }

    fn rects(count: usize) -> String {
        wrap(&"<rect width=\"1\" height=\"1\"/>".repeat(count))
    }

    #[test]
    fn ten_thousand_elements_are_accepted_and_one_more_is_not() {
        assert_eq!(MAX_SVG_ELEMENTS, 10_000);
        // the root counts: 9 999 children
        assert!(svg(&rects(9_999)).is_ok());
        assert_eq!(refused(&rects(10_000)), Reason::TooManyElements);
        assert_eq!(refused(&rects(20_000)), Reason::TooManyElements);
    }

    #[test]
    fn a_use_counts_what_it_stands_for_and_cannot_stand_for_a_use() {
        let shapes = "<rect width=\"1\" height=\"1\"/>".repeat(100);
        let uses = |n: usize| "<use href=\"#a\"/>".repeat(n);
        // 1 root + defs + g + 100 rects + n uses + n * 101
        assert!(
            svg(&wrap(&format!(
                "<defs><g id=\"a\">{shapes}</g></defs>{}",
                uses(50)
            )))
            .is_ok()
        );
        assert_eq!(
            refused(&wrap(&format!(
                "<defs><g id=\"a\">{shapes}</g></defs>{}",
                uses(100)
            ))),
            Reason::TooManyElements
        );
        // reuse that multiplies
        let nested = "<defs><g id=\"a\"><rect/></g><g id=\"b\"><use href=\"#a\"/><use href=\"#a\"/></g></defs><use href=\"#b\"/>";
        assert_eq!(refused(&wrap(nested)), Reason::SvgNotAllowed);
        // a use inside its own target
        assert_eq!(
            refused(&wrap("<g id=\"a\"><use href=\"#a\"/></g>")),
            Reason::SvgNotAllowed
        );
        // a use of a use
        assert_eq!(
            refused(&wrap(
                "<rect id=\"r\"/><use id=\"u\" href=\"#r\"/><use href=\"#u\"/>"
            )),
            Reason::SvgNotAllowed
        );
    }

    #[test]
    fn nesting_is_bounded() {
        let deep = |n: usize| wrap(&format!("{}{}", "<g>".repeat(n), "</g>".repeat(n)));
        assert!(svg(&deep(60)).is_ok());
        assert_eq!(refused(&deep(70)), Reason::SvgNotAllowed);
    }
}

mod svg_faults {
    use super::*;

    #[test]
    fn a_script_is_refused() {
        for inner in [
            "<script>alert(1)</script>",
            "<script type=\"text/javascript\"><![CDATA[ x ]]></script>",
            "<script/>",
            "<script href=\"#a\"/>",
            "<g><g><script>1</script></g></g>",
            "<SCRIPT>1</SCRIPT>",
            "<svg:script xmlns:svg=\"http://www.w3.org/2000/svg\"/>",
        ] {
            assert_eq!(refused(&wrap(inner)), Reason::SvgScript, "{inner}");
        }
        // a script as the root cannot hide behind "not an svg"
        assert_eq!(refused("<script>1</script>"), Reason::SvgScript);
    }

    #[test]
    fn an_event_handler_is_refused() {
        for attribute in [
            "onload",
            "onclick",
            "onmouseover",
            "onerror",
            "onfocusin",
            "ONLOAD",
            "OnClick",
            "onbegin",
            "on日本",
        ] {
            let source = wrap(&format!("<rect {attribute}=\"alert(1)\"/>"));
            assert_eq!(refused(&source), Reason::SvgEventHandler, "{attribute}");
        }
        assert_eq!(
            refused(&format!("<svg {NS} onload=\"alert(1)\"/>")),
            Reason::SvgEventHandler
        );
        // on an element that is itself refused, the handler is still the verdict
        assert_eq!(
            refused(&wrap("<a onclick=\"x\"/>")),
            Reason::SvgEventHandler
        );
        // "on" alone and names that merely contain it are not handlers
        assert!(svg(&wrap("<rect opacity=\"1\" x=\"1\"/>")).is_ok());
    }

    #[test]
    fn a_foreign_object_is_refused() {
        for inner in [
            "<foreignObject width=\"1\" height=\"1\"><div>hi</div></foreignObject>",
            "<foreignobject/>",
            "<g><foreignObject/></g>",
        ] {
            assert_eq!(refused(&wrap(inner)), Reason::SvgForeignObject, "{inner}");
        }
    }

    #[test]
    fn a_document_type_or_an_entity_is_refused() {
        for source in [
            "<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\"><svg/>",
            "<!DOCTYPE svg><svg/>",
            "<!DOCTYPE svg [ <!ENTITY x \"y\"> ]><svg>&x;</svg>",
            "<!DOCTYPE svg [ <!ENTITY xxe SYSTEM \"file:///etc/passwd\"> ]><svg><text>&xxe;</text></svg>",
            "<?xml version=\"1.0\"?><!DOCTYPE svg [ <!ENTITY a \"aaaaaaaaaa\"> <!ENTITY b \"&a;&a;&a;&a;\"> ]><svg>&b;</svg>",
            "<!DOCTYPE svg [ <!ELEMENT svg ANY> ]><svg/>",
            "<!DOCTYPE svg [ <!ENTITY",
            "<!DOCTYPE svg [ <!ENTITY % p SYSTEM \"http://x/y.dtd\"> %p; ]><svg/>",
        ] {
            assert_eq!(refused(source), Reason::SvgDoctype, "{source}");
        }
    }

    #[test]
    fn a_reference_to_anything_outside_the_file_is_refused() {
        let cases = [
            // href, in every spelling, to every kind of target
            "<image href=\"http://example.com/a.png\"/>",
            "<image href=\"https://example.com/a.png\"/>",
            "<image xlink:href=\"file:///etc/passwd\"/>",
            "<image href=\"data:image/png;base64,AAAA\"/>",
            "<image href=\"../img/0\"/>",
            "<image href=\"img/0\"/>",
            "<image href=\"/etc/passwd\"/>",
            "<use href=\"other.svg#a\"/>",
            "<use xlink:href=\"http://example.com/a.svg#a\"/>",
            "<use href=\"\"/>",
            "<use href=\"#\"/>",
            "<use href=\" #a \"/>",
            "<use href=\"javascript:alert(1)\"/>",
            "<rect href=\"//example.com/x\"/>",
            "<linearGradient href=\"gradient.svg#g\"/>",
            // url(): not a fragment
            "<rect fill=\"url(http://example.com/p.svg#a)\"/>",
            "<rect fill=\"url('http://example.com/p.svg#a')\"/>",
            "<rect fill=\"url(file:///x)\"/>",
            "<rect fill=\"url(../p.svg#a)\"/>",
            "<rect fill=\"url()\"/>",
            "<rect fill=\"url(#)\"/>",
            "<rect fill=\"URL(http://x/y)\"/>",
            "<rect clip-path=\"url( 'x.svg#c' )\"/>",
            "<rect fill=\"url(#a\"/>",
            "<rect fill=\"url(#a) url(//x/y)\"/>",
            "<rect style=\"fill:url(http://example.com/x)\"/>",
            // imports
            "<rect style=\"@import url(http://example.com/a.css)\"/>",
            "<rect fill=\"@import 'a.css'\"/>",
            "<style>@import url(http://example.com/a.css);</style>",
            "<style>@import 'a.css';</style>",
            "<style>rect { fill: url(http://example.com/x) }</style>",
            "<style><![CDATA[ @import 'a.css'; ]]></style>",
            // a character reference does not hide it
            "<rect fill=\"&#117;rl(http://x/y)\"/>",
            "<use href=\"&#104;ttp://x/y\"/>",
            "<rect style=\"&#64;import 'a.css'\"/>",
        ];
        for inner in cases {
            let source =
                format!("<svg {NS} xmlns:xlink=\"http://www.w3.org/1999/xlink\">{inner}</svg>");
            assert_eq!(refused(&source), Reason::SvgExternalReference, "{inner}");
        }
        // a stylesheet processing instruction
        assert_eq!(
            refused(&format!(
                "<?xml-stylesheet href=\"a.css\" type=\"text/css\"?><svg {NS}/>"
            )),
            Reason::SvgExternalReference
        );
    }

    #[test]
    fn a_relative_reference_is_refused_like_any_other() {
        // F5: Typst resolves a relative `href` through the World. An SVG that could read `/img/0` is refused.
        for target in [
            "../img/0",
            "../../etc/passwd",
            "./logo.png",
            "logo.png",
            "img/0",
            "/img/0",
        ] {
            let source =
                format!("<svg {NS}><image href=\"{target}\" width=\"5\" height=\"5\"/></svg>");
            assert_eq!(refused(&source), Reason::SvgExternalReference, "{target}");
        }
    }

    #[test]
    fn a_fragment_that_is_not_in_the_file_is_outside_the_file() {
        assert_eq!(
            refused(&wrap("<use href=\"#missing\"/>")),
            Reason::SvgExternalReference
        );
        assert_eq!(
            refused(&wrap("<rect fill=\"url(#missing)\"/>")),
            Reason::SvgExternalReference
        );
        assert_eq!(
            refused(&wrap("<rect style=\"clip-path:url(#missing)\"/>")),
            Reason::SvgExternalReference
        );
    }

    #[test]
    fn something_else_that_is_not_on_the_list_is_not_allowed() {
        for inner in [
            "<a href=\"#x\"><rect/></a>",
            "<style>rect { fill: red }</style>",
            "<style/>",
            // T48/F3: an element inside a `<style>` is refused, it does not panic (security-review F3)
            "<style><rect/></style>",
            "<style><g><style/></g></style>",
            "<style><style><rect/></style></style>",
            "<style>text<rect/>text</style>",
            "<g><style><rect/></style></g>",
            "<set attributeName=\"x\" to=\"1\"/>",
            "<animate attributeName=\"x\" to=\"1\"/>",
            "<filter id=\"f\"><feGaussianBlur stdDeviation=\"2\"/></filter>",
            "<pattern id=\"p\"/>",
            "<symbol id=\"s\"/>",
            "<marker id=\"m\"/>",
            "<image href=\"#x\"/>",
            "<metadata>x</metadata>",
            "<switch/>",
            "<textPath href=\"#x\"/>",
            "<rect class=\"a\"/>",
            "<rect data-name=\"a\"/>",
            "<rect onclick=\"\" />", // a handler, below
            "<rect inkscape:label=\"x\"/>",
            "<rect style=\"cursor:pointer\"/>",
            "<rect style=\"fill:red !important\"/>",
            "<rect style=\"fill\"/>",
            "<rect fill=\"re\\64\"/>",
            "<rect fill=\"red/* x */\"/>",
            "<rect xml:space=\"bogus\"/>",
            "<g>text outside a text element</g>",
            "<svg:rect xmlns:svg=\"http://www.w3.org/2000/svg\"/>",
            "<rect xmlns=\"http://example.com/other\"/>",
            "<rect xmlns:xlink=\"http://example.com/other\"/>",
            "<foo:rect xmlns:foo=\"http://example.com/foo\"/>",
            "<rect foo:bar=\"1\" xmlns:foo=\"http://example.com/foo\"/>",
        ] {
            let expected = if inner.contains("onclick") {
                Reason::SvgEventHandler
            } else {
                Reason::SvgNotAllowed
            };
            // `fill` twice is a duplicate, `inkscape:` a foreign namespace: all "not allowed"
            assert_eq!(refused(&wrap(inner)), expected, "{inner}");
        }
        assert_eq!(
            refused(&format!("<svg {NS} class=\"x\"/>")),
            Reason::SvgNotAllowed
        );
        // a namespace that is declared and never used is dropped, not refused
        let out = svg_out(&format!(
            "<svg {NS} xmlns:inkscape=\"http://www.inkscape.org/namespaces/inkscape\"><rect/></svg>"
        ));
        assert_eq!(
            out,
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>"
        );
    }

    #[test]
    fn a_specific_fault_wins_over_not_allowed_wherever_it_sits() {
        // The element is refused too, but what the attributes show is the more useful answer.
        assert_eq!(
            refused(&wrap("<a href=\"http://x/y\"><rect/></a>")),
            Reason::SvgExternalReference
        );
        assert_eq!(
            refused(&wrap("<foo onload=\"x\"/>")),
            Reason::SvgEventHandler
        );
        assert_eq!(
            refused(&wrap("<foo style=\"@import 'x'\"/>")),
            Reason::SvgExternalReference
        );
        assert_eq!(
            refused(&wrap("<foo><script/></foo>")),
            Reason::SvgNotAllowed,
            "first fault: the element"
        );
    }

    #[test]
    fn every_reason_has_a_stable_distinct_name() {
        let names: Vec<&str> = Reason::ALL.iter().map(|r| r.as_str()).collect();
        assert_eq!(
            names,
            [
                "unsupported_format",
                "too_many_bytes",
                "too_many_pixels",
                "too_many_elements",
                "svg_script",
                "svg_event_handler",
                "svg_foreign_object",
                "svg_doctype",
                "svg_external_reference",
                "svg_not_allowed",
            ]
        );
        for reason in Reason::ALL {
            assert_eq!(
                serde_json::to_string(&reason).expect("json"),
                format!("\"{}\"", reason.as_str())
            );
        }
    }
}

mod clean_files {
    use super::*;

    /// What a design tool writes: groups, a clip path by fragment, gradients, a `use` of a shape.
    pub(super) const FIGMA_LIKE: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: a design tool -->
<svg width="120" height="48" viewBox="0 0 120 48" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g clip-path="url(#clip0_1_2)">
<rect width="120" height="48" fill="url(#paint0_linear)"/>
<path d="M10 10L30 10L20 30Z" fill="#E50339" fill-rule="evenodd"/>
<use xlink:href="#dot" x="40" y="10"/>
<use href="#dot" x="60" y="10"/>
</g>
<defs>
<linearGradient id="paint0_linear" x1="0" y1="0" x2="120" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#f1f1f4"/></linearGradient>
<clipPath id="clip0_1_2"><rect width="120" height="48" fill="white"/></clipPath>
<circle id="dot" cx="5" cy="5" r="5" fill="#595C69"/>
</defs>
</svg>
"##;

    /// What Inkscape writes: styles in attributes.
    pub(super) const INKSCAPE_LIKE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<g id="layer1"><path id="path1" style="fill:#e50339;fill-opacity:1;stroke:none;stroke-width:0.5" d="M 0,0 H 64 V 64 Z"/>
<text x="4" y="40" style="font-family:Ubuntu;font-size:12px;fill:url(#g)">Well &amp; D &#8364; <tspan x="4" dy="14">two</tspan></text></g>
<defs><radialGradient id="g"><stop offset="0" style="stop-color:#000;stop-opacity:1"/><stop offset="1" style="stop-color:#fff"/></radialGradient></defs>
<g style="enable-background:new 0 0 64 64;display:inline"/>
</svg>"##;

    #[test]
    fn a_design_tools_svg_is_accepted() {
        let out = svg_out(FIGMA_LIKE);
        assert!(
            out.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\""),
            "{out}"
        );
        assert!(out.contains("clip-path=\"url(#clip0_1_2)\""));
        assert!(out.contains("<use href=\"#dot\" x=\"40\""));
        assert!(!out.contains("xlink"), "{out}");
        assert!(!out.contains("<!--") && !out.contains("<?xml"));
        assert!(
            out.contains("fill=\"#E50339\""),
            "values are kept as they were"
        );
    }

    #[test]
    fn inline_styles_become_attributes() {
        let out = svg_out(INKSCAPE_LIKE);
        assert!(!out.contains("style="), "{out}");
        assert!(
            out.contains("fill=\"#e50339\"") && out.contains("stroke-width=\"0.5\""),
            "{out}"
        );
        assert!(
            out.contains("fill=\"url(#g)\"") && out.contains("stop-color=\"#000\""),
            "{out}"
        );
        assert!(
            out.contains("Well &amp; D € <tspan x=\"4\" dy=\"14\">two</tspan>"),
            "{out}"
        );
        assert!(!out.contains("enable-background"));
        assert!(out.contains("<g display=\"inline\"/>"), "{out}");
    }

    #[test]
    fn a_style_wins_over_an_attribute_of_the_same_name() {
        let out = svg_out(&wrap("<rect fill=\"red\" style=\"fill:blue\"/>"));
        assert!(out.contains("<rect fill=\"blue\"/>"), "{out}");
        let out = svg_out(&wrap("<rect style=\"fill:blue\" fill=\"red\"/>"));
        assert!(
            out.contains("fill=\"red\""),
            "an attribute after the style replaces it: {out}"
        );
    }

    #[test]
    fn the_rebuild_is_exact_for_a_simple_file() {
        assert_eq!(
            svg_out(
                "<?xml version=\"1.0\"?>\n<svg width=\"10\" height=\"10\">\n  <!-- c -->\n  <rect x=\"1\" y=\"2\" width=\"3\" height=\"4\" fill=\"#e50339\"></rect>\n</svg>\n"
            ),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><rect x=\"1\" y=\"2\" width=\"3\" height=\"4\" fill=\"#e50339\"/></svg>"
        );
    }

    #[test]
    fn a_byte_order_mark_a_declaration_and_comments_are_accepted() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"  <?xml version=\"1.0\" encoding=\"utf-8\"?><!-- x --><svg/>");
        assert_eq!(ingest(&bytes).expect("svg").format, Format::Svg);
    }

    #[test]
    fn text_survives_with_its_characters() {
        let out = svg_out(&wrap(
            "<title>a &lt; b &amp; c</title><text><![CDATA[x < y & z]]><tspan>&#x41;&#66;&quot;&apos;</tspan></text>",
        ));
        assert!(out.contains("<title>a &lt; b &amp; c</title>"), "{out}");
        assert!(
            out.contains("<text>x &lt; y &amp; z<tspan>AB\"'</tspan></text>"),
            "{out}"
        );
    }

    #[test]
    fn attribute_values_are_escaped_on_the_way_out() {
        let out = svg_out(&wrap(
            "<rect id=\"a&quot;b&amp;c&lt;&gt;&#10;\" fill=\"red\"/>",
        ));
        assert!(out.contains("id=\"a&quot;b&amp;c&lt;&gt;&#10;\""), "{out}");
        // and what comes out reads back as the same file
        assert_eq!(svg_out(&out), out);
    }

    #[test]
    fn the_rebuild_is_idempotent() {
        for source in [FIGMA_LIKE, INKSCAPE_LIKE, "<svg/>"] {
            let once = svg_out(source);
            assert_eq!(svg_out(&once), once);
        }
    }

    #[test]
    fn what_comes_out_holds_no_reference_but_a_fragment_that_is_defined() {
        for source in [FIGMA_LIKE, INKSCAPE_LIKE] {
            let out = svg_out(source);
            // every href is #id of an id in the file
            let mut rest = out.as_str();
            while let Some(at) = rest.find("href=\"") {
                rest = &rest[at + 6..];
                let value = &rest[..rest.find('"').expect("closing quote")];
                let id = value.strip_prefix('#').expect("a fragment");
                assert!(out.contains(&format!("id=\"{id}\"")), "{id} in {out}");
            }
            // the namespace the file declares is the only address in it
            let without_namespace = out.replacen("xmlns=\"http://www.w3.org/2000/svg\"", "", 1);
            for forbidden in [
                "http:",
                "https:",
                "file:",
                "xlink",
                "@import",
                "<style",
                "<script",
                "<!",
                "<?",
                "javascript",
            ] {
                assert!(
                    !without_namespace.contains(forbidden),
                    "{forbidden} in {out}"
                );
            }
        }
    }

    #[test]
    fn the_rebuilt_file_is_utf8_without_a_declaration() {
        let got = ingest("<svg><title>€ 漢字 😀</title></svg>".as_bytes()).expect("svg");
        let text = String::from_utf8(got.bytes).expect("utf-8");
        assert!(text.contains("€ 漢字 😀"));
    }
}

mod no_panic {
    use super::*;

    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
    }

    #[test]
    fn nothing_a_caller_sends_makes_ingestion_panic() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let seeds: Vec<Vec<u8>> = vec![
            REAL_PNG.to_vec(),
            png(30, 30),
            jpeg(30, 30),
            wrap("<g id=\"a\"><rect/></g><use href=\"#a\"/><text style=\"fill:url(#a)\">x</text>")
                .into_bytes(),
            b"<svg onload=".to_vec(),
            // T48/F3: elements inside `<style>`, plain and nested
            wrap("<style><rect/></style>").into_bytes(),
            wrap("<style><g><style/></g></style>").into_bytes(),
            "<svg a=\"日本\" 日本=\"x\"><rect on日本=\"1\"/></svg>"
                .as_bytes()
                .to_vec(),
        ];
        for round in 0..6_000 {
            let mut bytes = seeds[round % seeds.len()].clone();
            match rng.next() % 4 {
                0 => {
                    // flip some bytes
                    for _ in 0..1 + rng.next() % 4 {
                        let at = (rng.next() as usize) % bytes.len();
                        bytes[at] = rng.next() as u8;
                    }
                }
                1 => {
                    let at = (rng.next() as usize) % bytes.len();
                    bytes.truncate(at);
                }
                2 => {
                    let at = (rng.next() as usize) % bytes.len();
                    let n = (rng.next() % 6) as usize;
                    let junk: Vec<u8> = (0..n).map(|_| rng.next() as u8).collect();
                    bytes.splice(at..at, junk);
                }
                _ => {
                    bytes = (0..rng.next() % 64).map(|_| rng.next() as u8).collect();
                    if rng.next().is_multiple_of(2) {
                        bytes.splice(0..0, *b"<");
                    }
                }
            }
            let _ = ingest(&bytes); // any answer, no panic
        }
    }
}

mod renders_through_a_world {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    use typst::diag::{FileError, FileResult};
    use typst::foundations::{Bytes, Datetime};
    use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
    use typst::text::{Font, FontBook};
    use typst::utils::LazyHash;
    use typst::{Library, LibraryExt, World};
    use typst_layout::PagedDocument;

    use super::*;

    fn vid(path: &str) -> FileId {
        RootedPath::new(VirtualRoot::Project, VirtualPath::new(path).expect("path")).intern()
    }

    struct Shared {
        library: LazyHash<Library>,
        book: LazyHash<FontBook>,
        main: FileId,
    }

    fn shared() -> &'static Shared {
        static SHARED: OnceLock<Shared> = OnceLock::new();
        SHARED.get_or_init(|| Shared {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(FontBook::new()),
            main: vid("/main.typ"),
        })
    }

    /// A World with no fonts whose only files are the ones it is given, and which records every request.
    struct LoggingWorld {
        files: HashMap<FileId, Bytes>,
        accessed: Mutex<Vec<String>>,
        source: Source,
    }

    impl LoggingWorld {
        fn new(asset: &str, files: &[(&str, &[u8])]) -> LoggingWorld {
            let main = shared().main;
            LoggingWorld {
                files: files
                    .iter()
                    .map(|(name, bytes)| (vid(name), Bytes::new(bytes.to_vec())))
                    .collect(),
                accessed: Mutex::new(Vec::new()),
                source: Source::new(
                    main,
                    format!(
                        "#set page(width: 40mm, height: 40mm, margin: 0pt)\n#image(\"{asset}\", width: 30mm)"
                    ),
                ),
            }
        }

        fn accessed(&self) -> Vec<String> {
            self.accessed.lock().expect("lock").clone()
        }
    }

    impl World for LoggingWorld {
        fn library(&self) -> &LazyHash<Library> {
            &shared().library
        }
        fn book(&self) -> &LazyHash<FontBook> {
            &shared().book
        }
        fn main(&self) -> FileId {
            shared().main
        }
        fn source(&self, id: FileId) -> FileResult<Source> {
            if id == shared().main {
                return Ok(self.source.clone());
            }
            self.accessed
                .lock()
                .expect("lock")
                .push(format!("source {id:?}"));
            Err(FileError::AccessDenied)
        }
        fn file(&self, id: FileId) -> FileResult<Bytes> {
            self.accessed
                .lock()
                .expect("lock")
                .push(format!("file {id:?}"));
            self.files.get(&id).cloned().ok_or(FileError::AccessDenied)
        }
        fn font(&self, _index: usize) -> Option<Font> {
            None
        }
        fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
            None
        }
    }

    fn compile(world: &LoggingWorld) -> Result<usize, String> {
        let warned = typst::compile::<PagedDocument>(world);
        match warned.output {
            Ok(doc) => Ok(doc.pages().len()),
            Err(errors) => Err(errors
                .iter()
                .map(|e| e.message.to_string())
                .collect::<Vec<_>>()
                .join("; ")),
        }
    }

    const FIGMA_LIKE: &str = clean_files::FIGMA_LIKE;

    /// A relative reference, as an SVG that was not rebuilt could carry (spike F5).
    const LEAKY: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\"><image href=\"../img/0\" width=\"20\" height=\"20\"/></svg>";

    #[test]
    fn the_control_a_file_that_was_not_rebuilt_does_read_through_the_world() {
        // If this stopped reading `/img/0`, the checks below would prove nothing: the World must be able
        // to see a leak for "no access beyond the asset" to mean anything.
        let world = LoggingWorld::new(
            "/asset/logo.svg",
            &[("/asset/logo.svg", LEAKY.as_bytes()), ("/img/0", &REAL_PNG)],
        );
        let _ = compile(&world);
        let accessed = world.accessed();
        assert!(
            accessed.iter().any(|a| a.contains("img/0")),
            "the instrument did not see the leak: {accessed:?}"
        );
    }

    #[test]
    fn a_rebuilt_svg_renders_and_reads_nothing_but_itself() {
        for (name, source) in [
            ("figma", FIGMA_LIKE),
            ("inkscape", clean_files::INKSCAPE_LIKE),
        ] {
            let rebuilt = ingest(source.as_bytes()).expect(name).bytes;
            let world = LoggingWorld::new(
                "/asset/logo.svg",
                &[
                    ("/asset/logo.svg", &rebuilt),
                    ("/img/0", &REAL_PNG),
                    ("/data.json", b"{\"secret\":1}"),
                ],
            );
            assert_eq!(compile(&world), Ok(1), "{name}");
            let accessed = world.accessed();
            assert!(!accessed.is_empty(), "the image was read");
            assert!(
                accessed.iter().all(|a| a.contains("asset/logo.svg")),
                "{name} read something else: {accessed:?}"
            );
        }
    }

    #[test]
    fn references_that_loop_inside_the_file_render_and_read_nothing_else() {
        // Fragments that point at each other: allowed by the rebuild (they are inside the file), and
        // Typst's SVG reader must cope with them. A hang here would be a hang of every render with the logo.
        for (name, inner) in [
            (
                "clip path in itself",
                "<clipPath id=\"a\" clip-path=\"url(#a)\"><rect width=\"5\" height=\"5\"/></clipPath><rect clip-path=\"url(#a)\" width=\"9\" height=\"9\"/>",
            ),
            (
                "gradients inheriting from each other",
                "<linearGradient id=\"a\" href=\"#b\"/><linearGradient id=\"b\" href=\"#a\"/><rect fill=\"url(#a)\" width=\"9\" height=\"9\"/>",
            ),
            (
                "mask in mask",
                "<mask id=\"m\"><rect mask=\"url(#m)\" width=\"5\" height=\"5\" fill=\"#fff\"/></mask><rect mask=\"url(#m)\" width=\"9\" height=\"9\"/>",
            ),
        ] {
            let source = format!(
                "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\" width=\"10\" height=\"10\">{inner}</svg>"
            );
            let rebuilt = ingest(source.as_bytes())
                .unwrap_or_else(|r| panic!("{name}: {r:?}"))
                .bytes;
            let world = LoggingWorld::new(
                "/asset/logo.svg",
                &[("/asset/logo.svg", &rebuilt), ("/img/0", &REAL_PNG)],
            );
            assert!(compile(&world).is_ok(), "{name}");
            assert!(
                world
                    .accessed()
                    .iter()
                    .all(|a| a.contains("asset/logo.svg")),
                "{name}: {:?}",
                world.accessed()
            );
        }
    }

    #[test]
    fn a_png_and_a_jpeg_are_read_as_themselves_only() {
        let world = LoggingWorld::new(
            "/asset/logo.png",
            &[("/asset/logo.png", &REAL_PNG), ("/img/0", &REAL_PNG)],
        );
        assert_eq!(compile(&world), Ok(1));
        assert!(
            world
                .accessed()
                .iter()
                .all(|a| a.contains("asset/logo.png")),
            "{:?}",
            world.accessed()
        );
    }
}
