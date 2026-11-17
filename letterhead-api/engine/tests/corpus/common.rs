//! What the tests share: the corpus on disk, rendering it, and the golden record's shape.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use letterhead_engine::assets::ingest;
use letterhead_engine::config::{LetterheadConfig, validate_config};
use letterhead_engine::content::{RenderRequest, validate_request};
use letterhead_engine::layout::{Assets, inspect};
use letterhead_engine::render::{LetterheadVersion, RenderError, Rendered, render};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use typst_layout::Page;

/// A4 in pt, as Typst has it.
pub const A4_WIDTH_PT: f64 = 595.2756;
pub const A4_HEIGHT_PT: f64 = 841.8898;

pub fn mm(value: f64) -> f64 {
    value * 72.0 / 25.4
}

// ─── the corpus on disk ──────────────────────────────────────────────────────────────────────────────────

pub fn data_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

/// One fixture: a request, and the letterhead it is rendered on.
pub struct Fixture {
    pub name: String,
    pub description: String,
    pub letterhead: String,
    pub request: RenderRequest,
}

/// Every fixture of `tests/golden/fixtures/`, by name. A fixture that is not a valid request is a broken
/// corpus, not a refusal to test.
pub fn fixtures() -> &'static [Fixture] {
    static FIXTURES: OnceLock<Vec<Fixture>> = OnceLock::new();
    FIXTURES.get_or_init(|| {
        let dir = data_dir().join("fixtures");
        let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
            .map(|entry| entry.expect("dir entry").path())
            .filter(|p| p.extension().is_some_and(|e| e == "json"))
            .collect();
        paths.sort();
        paths
            .into_iter()
            .map(|path| {
                let value = read_json(&path);
                let name = path
                    .file_stem()
                    .expect("file name")
                    .to_string_lossy()
                    .into_owned();
                let request = validate_request(&value["request"]).unwrap_or_else(|e| {
                    panic!("fixture {name} is not a valid request: {}", e.code())
                });
                Fixture {
                    description: value["description"]
                        .as_str()
                        .expect("description")
                        .to_owned(),
                    letterhead: value["letterhead"].as_str().expect("letterhead").to_owned(),
                    request,
                    name,
                }
            })
            .collect()
    })
}

pub fn fixture(name: &str) -> &'static Fixture {
    fixtures()
        .iter()
        .find(|f| f.name == name)
        .unwrap_or_else(|| panic!("no fixture named {name}"))
}

pub fn letterhead(name: &str) -> LetterheadConfig {
    let value = read_json(&data_dir().join("letterheads").join(format!("{name}.json")));
    validate_config(&value).unwrap_or_else(|problems| {
        panic!(
            "letterhead {name} is not a valid configuration: {:?}",
            problems
                .iter()
                .map(|p| (&p.path, p.reason))
                .collect::<Vec<_>>()
        )
    })
}

/// The stored bytes of every asset of the corpus, by id. As the service stores them: an image goes through
/// `assets::ingest` and what comes out (for an SVG, the rebuilt file) is what the engine is given.
pub fn assets() -> &'static Assets {
    static ASSETS: OnceLock<Assets> = OnceLock::new();
    ASSETS.get_or_init(|| {
        let dir = data_dir().join("assets");
        let mut assets = Assets::new();
        for entry in fs::read_dir(&dir).unwrap_or_else(|e| panic!("read {}: {e}", dir.display())) {
            let path = entry.expect("dir entry").path();
            let id = path
                .file_stem()
                .expect("file name")
                .to_string_lossy()
                .into_owned();
            let bytes = fs::read(&path).expect("read asset");
            let ingested = ingest(&bytes)
                .unwrap_or_else(|reason| panic!("asset {id} is refused: {}", reason.as_str()));
            assets.insert(id, ingested.bytes);
        }
        assets
    })
}

pub fn version(layout_version: u32, config: LetterheadConfig) -> LetterheadVersion {
    LetterheadVersion {
        number: 1,
        layout_version,
        config,
    }
}

// ─── rendering ───────────────────────────────────────────────────────────────────────────────────────────

/// Render a fixture on its letterhead with a layout, from scratch.
pub fn render_fresh(layout: u32, fixture: &Fixture) -> Result<Rendered, RenderError> {
    render(
        &fixture.request,
        &version(layout, letterhead(&fixture.letterhead)),
        assets(),
    )
}

type Cached = Result<Arc<Rendered>, RenderError>;

/// A fixture's render, made once per layout for the whole test binary: the larger fixtures take seconds in a
/// debug build and several tests read each of them. A test about determinism renders afresh instead.
pub fn rendered(layout: u32, fixture: &Fixture) -> Cached {
    type Cell = Arc<OnceLock<Cached>>;
    static CACHE: OnceLock<Mutex<HashMap<(u32, String), Cell>>> = OnceLock::new();
    let cell: Cell = {
        let mut cache = CACHE.get_or_init(Default::default).lock().expect("cache");
        cache
            .entry((layout, fixture.name.clone()))
            .or_default()
            .clone()
    };
    cell.get_or_init(|| render_fresh(layout, fixture).map(Arc::new))
        .clone()
}

/// The render of a fixture that must succeed.
pub fn rendered_ok(layout: u32, name: &str) -> Arc<Rendered> {
    rendered(layout, fixture(name)).unwrap_or_else(|e| {
        panic!(
            "fixture {name} must render on layout {layout}, got {}",
            e.code()
        )
    })
}

// ─── reading a rendered document ─────────────────────────────────────────────────────────────────────────

/// A line of a page, with the page it is on.
#[derive(Debug, Clone, PartialEq)]
pub struct PageLine {
    pub page: usize,
    pub y: f64,
    pub x: f64,
    pub text: String,
}

/// The lines whose baseline lies between the top margin and the bottom margin: the body, and nothing of a header
/// or footer (a frame is drawn inside its margin, `FRAME_GAP_MM` from the body).
pub fn body_lines(rendered: &Rendered, config: &LetterheadConfig) -> Vec<PageLine> {
    let top = mm(config.margins.top);
    let bottom = A4_HEIGHT_PT - mm(config.margins.bottom);
    let mut out = Vec::new();
    for (index, page) in rendered.document().pages().iter().enumerate() {
        for line in inspect::lines(page) {
            if line.y >= top && line.y <= bottom {
                out.push(PageLine {
                    page: index + 1,
                    y: line.y,
                    x: line.left,
                    text: line.text,
                });
            }
        }
    }
    out
}

/// The text with every run of whitespace removed: what two extractions of one text agree on whatever they do
/// with line ends.
pub fn squash(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The text with every run of whitespace turned into one space (amendment A5).
pub fn normalise(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ─── the golden record ───────────────────────────────────────────────────────────────────────────────────

/// A position in a golden may differ from the engine's by this much and still be the same position: 0.01 pt is
/// 0.0035 mm, three orders of magnitude below any change that moves a line. The record keeps 3 decimals; the
/// slack absorbs the last bit of a float that two platforms' maths libraries do not agree on.
pub const POSITION_EPSILON_PT: f64 = 0.01;

/// One line of a page: the runs that share a baseline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineRecord {
    /// The baseline.
    pub y: f64,
    /// The left edge of the line's first run.
    pub x: f64,
    /// The right edge of its last run.
    pub right: f64,
    pub text: String,
    /// The left edge of each run after the first, when the line has more than one (cells side by side, the
    /// zones of a footer): a column that moves shows here.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub xs: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageRecord {
    /// The page's text in reading order.
    pub text: String,
    pub lines: Vec<LineRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub fixture: String,
    pub layout: u32,
    /// `rendered`, or `refused` with the engine's error code.
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub page_count: usize,
    pub missing_placeholders: Vec<String>,
    pub unprintable_characters: usize,
    pub pages: Vec<PageRecord>,
}

fn round3(value: f64) -> f64 {
    // `+ 0.0` turns -0.0 into 0.0 so the file never says "-0.0".
    (value * 1000.0).round() / 1000.0 + 0.0
}

/// What the engine does with a fixture, as a record.
pub fn record_of(layout: u32, name: &str, outcome: &Cached) -> Record {
    match outcome {
        Err(error) => Record {
            fixture: name.to_owned(),
            layout,
            outcome: "refused".to_owned(),
            error: Some(error.code().to_owned()),
            page_count: 0,
            missing_placeholders: Vec::new(),
            unprintable_characters: 0,
            pages: Vec::new(),
        },
        Ok(rendered) => record_of_pages(
            layout,
            name,
            rendered.document().pages(),
            rendered.page_texts(),
            rendered
                .missing_placeholders
                .iter()
                .map(|s| (*s).to_owned())
                .collect(),
        ),
    }
}

/// The record of a laid-out document. `render` is `compile` and a page limit, so a document compiled by hand
/// (the pinning test compiles with a layout that the registry does not hold) has the same record.
pub fn record_of_pages(
    layout: u32,
    name: &str,
    pages: &[Page],
    texts: Vec<String>,
    missing_placeholders: Vec<String>,
) -> Record {
    Record {
        fixture: name.to_owned(),
        layout,
        outcome: "rendered".to_owned(),
        error: None,
        page_count: pages.len(),
        missing_placeholders,
        unprintable_characters: pages.iter().map(inspect::unprintable_characters).sum(),
        pages: pages
            .iter()
            .zip(texts)
            .map(|(page, text)| PageRecord {
                text,
                lines: inspect::lines(page)
                    .into_iter()
                    .map(|line| LineRecord {
                        y: round3(line.y),
                        x: round3(line.left),
                        right: round3(line.right),
                        text: line.text,
                        xs: if line.runs.len() > 1 {
                            line.runs[1..].iter().map(|r| round3(r.x)).collect()
                        } else {
                            Vec::new()
                        },
                    })
                    .collect(),
            })
            .collect(),
    }
}

/// The file's text: one JSON object per line of a page, so that a moved line is one changed line in `git diff`.
pub fn format_record(record: &Record) -> String {
    let mut out = String::from("{\n");
    out += &format!(" \"fixture\": {},\n", json(&record.fixture));
    out += &format!(" \"layout\": {},\n", record.layout);
    out += &format!(" \"outcome\": {},\n", json(&record.outcome));
    if let Some(error) = &record.error {
        out += &format!(" \"error\": {},\n", json(error));
    }
    out += &format!(" \"pageCount\": {},\n", record.page_count);
    out += &format!(
        " \"missingPlaceholders\": {},\n",
        serde_json::to_string(&record.missing_placeholders).expect("json")
    );
    out += &format!(
        " \"unprintableCharacters\": {},\n",
        record.unprintable_characters
    );
    out += " \"pages\": [";
    for (i, page) in record.pages.iter().enumerate() {
        out += if i == 0 { "\n  {\n" } else { ",\n  {\n" };
        out += &format!("   \"text\": {},\n", json(&page.text));
        out += "   \"lines\": [";
        for (j, line) in page.lines.iter().enumerate() {
            out += if j == 0 { "\n    " } else { ",\n    " };
            out += &serde_json::to_string(line).expect("json");
        }
        out += if page.lines.is_empty() {
            "]\n  }"
        } else {
            "\n   ]\n  }"
        };
    }
    out += if record.pages.is_empty() {
        "]\n}\n"
    } else {
        "\n ]\n}\n"
    };
    out
}

fn json<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string(value).expect("json")
}

pub fn golden_path(layout: u32, fixture: &str) -> PathBuf {
    data_dir()
        .join(format!("layout-{layout}"))
        .join(format!("{fixture}.json"))
}

pub fn read_record(path: &Path) -> Result<Record, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("cannot parse {}: {e}", path.display()))
}

/// How an actual record differs from a golden one: every difference, one line each, in the order of the page.
pub fn differences(golden: &Record, actual: &Record) -> Vec<String> {
    let mut out = Vec::new();
    macro_rules! same {
        ($label:expr, $a:expr, $b:expr) => {
            if $a != $b {
                out.push(format!("{}: golden {:?}, now {:?}", $label, $a, $b));
            }
        };
    }
    same!("fixture", golden.fixture, actual.fixture);
    same!("layout", golden.layout, actual.layout);
    same!("outcome", golden.outcome, actual.outcome);
    same!("error", golden.error, actual.error);
    same!("page count", golden.page_count, actual.page_count);
    same!(
        "missing placeholders",
        golden.missing_placeholders,
        actual.missing_placeholders
    );
    same!(
        "unprintable characters",
        golden.unprintable_characters,
        actual.unprintable_characters
    );
    for (n, (g, a)) in golden.pages.iter().zip(&actual.pages).enumerate() {
        let page = n + 1;
        if g.text != a.text {
            let first = g
                .text
                .lines()
                .zip(a.text.lines())
                .position(|(x, y)| x != y)
                .unwrap_or_else(|| g.text.lines().count().min(a.text.lines().count()));
            out.push(format!(
                "page {page}: text differs from line {} (golden {:?}, now {:?})",
                first + 1,
                g.text.lines().nth(first),
                a.text.lines().nth(first)
            ));
        }
        if g.lines.len() != a.lines.len() {
            out.push(format!(
                "page {page}: {} lines in the golden, {} now",
                g.lines.len(),
                a.lines.len()
            ));
        }
        for (i, (gl, al)) in g.lines.iter().zip(&a.lines).enumerate() {
            let at = format!("page {page} line {} {:?}", i + 1, gl.text);
            if gl.text != al.text {
                out.push(format!("{at}: text now {:?}", al.text));
                continue;
            }
            let moved = |name: &str, g: f64, a: f64, out: &mut Vec<String>| {
                if (g - a).abs() > POSITION_EPSILON_PT {
                    out.push(format!("{at}: {name} {g} -> {a} ({:+.3} pt)", a - g));
                }
            };
            moved("baseline", gl.y, al.y, &mut out);
            moved("x", gl.x, al.x, &mut out);
            moved("right edge", gl.right, al.right, &mut out);
            if gl.xs.len() != al.xs.len() {
                out.push(format!(
                    "{at}: {} runs in the golden, {} now",
                    gl.xs.len() + 1,
                    al.xs.len() + 1
                ));
            } else {
                for (k, (gx, ax)) in gl.xs.iter().zip(&al.xs).enumerate() {
                    moved(&format!("run {} x", k + 2), *gx, *ax, &mut out);
                }
            }
        }
    }
    out
}

/// The fixture names that have a golden file in a layout's directory.
pub fn golden_names(layout: u32) -> BTreeMap<String, PathBuf> {
    let dir = data_dir().join(format!("layout-{layout}"));
    let mut out = BTreeMap::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries {
            let path = entry.expect("dir entry").path();
            if path.extension().is_some_and(|e| e == "json") {
                out.insert(
                    path.file_stem()
                        .expect("file name")
                        .to_string_lossy()
                        .into_owned(),
                    path,
                );
            }
        }
    }
    out
}
