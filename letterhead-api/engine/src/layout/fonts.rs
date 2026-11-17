//! The fonts of layout 1: a closed list of 13 files bundled with the service (AC-7.5).
//!
//! Each file is pinned by its SHA-256 here, in code, and a test recomputes the digest of the bytes that are
//! compiled in. A font file that is replaced, even by an upstream "fix" under the same name, fails that test:
//! a new font file is a new layout (ADR 20261116-a-letterhead-version-pins-its-layout...), because it can move
//! lines. The World has no font path of its own: these are the only fonts a render can ever see, and nothing
//! is fetched at render time.
//!
//! Licences are beside the files in `engine/fonts/`: the SIL Open Font License 1.1 for DM Sans, DM Mono, Syne
//! and Noto Serif, the Ubuntu Font Licence 1.0 for Ubuntu. All five families have `fsType = 0` (installable
//! embedding), so a PDF may embed them (spike, § Results).

use crate::config::Font;

/// One bundled font file.
pub struct FontFile {
    /// The file name under `engine/fonts/`.
    pub file: &'static str,
    /// The family this file belongs to.
    pub font: Font,
    /// Lower-case hexadecimal SHA-256 of the file's bytes.
    pub sha256: &'static str,
    pub bytes: &'static [u8],
}

/// The name that Typst knows a family by. It is the family in the font file's name table, which for the
/// DM Sans variable font is "DM Sans 9pt" (its default optical size) and not the "DM Sans" that the closed
/// list and the configurator show.
pub fn typst_family(font: Font) -> &'static str {
    match font {
        Font::DmSans => "DM Sans 9pt",
        other => other.name(),
    }
}

macro_rules! font_file {
    ($file:literal, $font:expr, $sha256:literal) => {
        FontFile {
            file: $file,
            font: $font,
            sha256: $sha256,
            bytes: include_bytes!(concat!("../../fonts/", $file)),
        }
    };
}

/// The 13 files of layout 1.
pub static LAYOUT_1_FONTS: [FontFile; 13] = [
    font_file!(
        "Ubuntu-Regular.ttf",
        Font::Ubuntu,
        "3128df86a31805618436d0ae5651ba4285d0c9de0a39057d025f64ee33bceb64"
    ),
    font_file!(
        "Ubuntu-Bold.ttf",
        Font::Ubuntu,
        "679b5c1e09cab3156bb8ef529735f9382bf31ca7ac737382ab959297f8d82ad4"
    ),
    font_file!(
        "Ubuntu-Italic.ttf",
        Font::Ubuntu,
        "4ab857e72f781a8967a6e4a9ac8858fbd6b3a9f9782db349d4b62b78ed02860b"
    ),
    font_file!(
        "Ubuntu-BoldItalic.ttf",
        Font::Ubuntu,
        "875d776e7f33c50b1d1b594791da0eba9865648f232f08bcba00bba9dfa01d96"
    ),
    font_file!(
        "Ubuntu-Medium.ttf",
        Font::Ubuntu,
        "3cd952b8b52581e48a8fa95b31c8829c2baa41b635042a69587d57f98092961e"
    ),
    font_file!(
        "NotoSerif[wdth,wght].ttf",
        Font::NotoSerif,
        "4d8e6761424656867019081a1a01336f3cb086982682698714054fc33f782713"
    ),
    font_file!(
        "NotoSerif-Italic[wdth,wght].ttf",
        Font::NotoSerif,
        "e87acbc6c0efd0d9a20d6a8cbbda2b266c14be3a3a6f5af8ec9d7b2460570ad1"
    ),
    font_file!(
        "DMSans[opsz,wght].ttf",
        Font::DmSans,
        "8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d"
    ),
    font_file!(
        "DMSans-Italic[opsz,wght].ttf",
        Font::DmSans,
        "22259c0cc8237221b80f44c76ba8d36e6bce3cda72779f5b2773643d499720ae"
    ),
    font_file!(
        "DMMono-Regular.ttf",
        Font::DmMono,
        "55b4c98f123daebb3ed27947ba47b2af00554fc6284d639a540bcef5e6258ad2"
    ),
    font_file!(
        "DMMono-Medium.ttf",
        Font::DmMono,
        "fd327daf461db87b44a87def475d251bf03b997f7c07d9680592d75dbbfaad0b"
    ),
    font_file!(
        "DMMono-Italic.ttf",
        Font::DmMono,
        "32b5bad9cbce64eac6d05c8abbeb619317f7e4cb354e1c33db761adbfaae1b16"
    ),
    font_file!(
        "Syne[wght].ttf",
        Font::Syne,
        "ce5ac77142a65cab2248a1a2ebb740b1d4d9c20b52488877d3ff664d1356104a"
    ),
];
