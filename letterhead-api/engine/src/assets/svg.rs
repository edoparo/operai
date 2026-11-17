//! SVG: read into a tree of allowlisted elements and attributes, checked, and written out again.
//!
//! Why rebuild and not filter: the engine renders an SVG through Typst, whose SVG reader resolves a
//! relative `href` through the World (spike F5), and an SVG is a program-shaped format (scripts, handlers,
//! foreign content, entities, stylesheets, `use`). Everything not named here is dropped by construction,
//! because the output is written only from what was recognised.
//!
//! The rules:
//!
//! - **Elements**: [`ELEMENTS`] only: shapes, `g`, `defs`, `use`, gradients, `stop`, `clipPath`, `mask`,
//!   `text`, `tspan`, `title`, `desc`. No `script`, `foreignObject`, `style`, `image`, `a`, `filter`,
//!   `pattern`, `symbol`, `marker`, animation, and no element in another namespace.
//! - **Attributes**: [`ATTRIBUTES`] only. `style` is not kept: its declarations are checked and moved to
//!   attributes when they are presentation properties, so an SVG saved with inline styles (Inkscape,
//!   Illustrator) still works; a `<style>` element and `class` do not. Every `on*` attribute is refused.
//! - **References**: the only reference is to something *inside the file*: `href="#id"` and `url(#id)`.
//!   Anything else (a web address, a file path, a relative path, `data:`, `javascript:`, `@import`, a
//!   stylesheet processing instruction) is `svg_external_reference`, and so is a `#id` that is not in the
//!   file. The output has no `xlink` and no `style`.
//! - **Declarations**: a document-type declaration, with or without entities, is refused (`svg_doctype`);
//!   entities other than the five predefined ones and numeric references are refused with it, since without
//!   a declaration they cannot exist.
//! - **Size**: at most [`MAX_SVG_ELEMENTS`] elements, where a `<use>` counts the elements it stands for,
//!   and a `<use>` cannot stand for something that holds a `<use>` (so reuse cannot multiply).
//!
//! The first fault found is the one reported; the specific ones (script, handler, foreign object, doctype,
//! external reference) win over "not allowed" for the same element, because the attributes of an element are
//! read before it is judged.

use std::collections::HashMap;

use xmlparser::{ElementEnd, Error as XmlError, Token, Tokenizer};

use super::{MAX_SVG_ELEMENTS, Reason};

const SVG_NS: &str = "http://www.w3.org/2000/svg";
const XLINK_NS: &str = "http://www.w3.org/1999/xlink";
/// Deeper than any real logo; it bounds the recursion of the writer and of the renderer after it.
const MAX_DEPTH: usize = 64;

const ELEMENTS: &[&str] = &[
    "svg",
    "g",
    "defs",
    "title",
    "desc",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "use",
];

/// Elements that hold text; in any other, text is only whitespace.
const TEXT_ELEMENTS: &[&str] = &["text", "tspan", "title", "desc"];

/// Presentation properties: valid as attributes and, with the same names, in a `style` attribute.
const PRESENTATION: &[&str] = &[
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "opacity",
    "clip-path",
    "clip-rule",
    "mask",
    "color",
    "display",
    "visibility",
    "stop-color",
    "stop-opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "letter-spacing",
    "word-spacing",
    "text-decoration",
    "shape-rendering",
];

/// The other attributes: geometry, structure, gradients.
const STRUCTURE: &[&str] = &[
    "id",
    "x",
    "y",
    "width",
    "height",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "x1",
    "y1",
    "x2",
    "y2",
    "fx",
    "fy",
    "points",
    "d",
    "transform",
    "viewBox",
    "preserveAspectRatio",
    "version",
    "clipPathUnits",
    "maskUnits",
    "maskContentUnits",
    "offset",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "dx",
    "dy",
    "rotate",
];

#[derive(Debug)]
struct Node {
    name: &'static str,
    attrs: Vec<(&'static str, String)>,
    children: Vec<Child>,
}

#[derive(Debug)]
enum Child {
    Element(usize),
    Text(String),
}

/// An element start being read.
struct Open {
    /// `Some` when the element is on the list; `None` when it is to be refused once its attributes have been
    /// read (so that a more specific fault in them wins).
    name: Option<&'static str>,
    attrs: Vec<(&'static str, String)>,
    /// The names of the attributes read so far, as written: a name twice is not XML.
    seen: Vec<String>,
    /// `<style>`: refused, but its text is read for an import first.
    style: bool,
}

#[derive(Default)]
struct Reader {
    nodes: Vec<Node>,
    stack: Vec<usize>,
    open: Option<Open>,
    /// Inside a `<style>` that is to be refused when it closes.
    in_style: bool,
    ids: HashMap<String, usize>,
    references: Vec<String>,
    root_seen: bool,
    elements: usize,
}

/// Rebuild an SVG: the bytes written, or why it is refused.
pub(super) fn sanitise(input: &[u8]) -> Result<Vec<u8>, Reason> {
    let input = input.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(input);
    let text = std::str::from_utf8(input).map_err(|_| Reason::UnsupportedFormat)?;
    // Space before an XML declaration is not XML, but it is what some tools write; the output is ours.
    let text = text.trim_start();
    if !text.starts_with('<') {
        return Err(Reason::UnsupportedFormat);
    }

    let mut reader = Reader::default();
    for token in Tokenizer::from(text) {
        match token {
            Ok(token) => reader.token(token)?,
            // A damaged declaration of a document type is still one.
            Err(XmlError::InvalidDoctype(..) | XmlError::InvalidEntity(..)) => {
                return Err(Reason::SvgDoctype);
            }
            Err(_) => return Err(Reason::UnsupportedFormat),
        }
    }
    reader.finish()
}

/// The five predefined entities and numeric character references; anything else cannot be there without a
/// declaration.
fn decode(raw: &str) -> Result<String, Reason> {
    if !raw.contains('&') {
        return Ok(raw.to_owned());
    }
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at + 1..];
        let end = rest.find(';').ok_or(Reason::UnsupportedFormat)?;
        let name = &rest[..end];
        match name {
            "amp" => out.push('&'),
            "lt" => out.push('<'),
            "gt" => out.push('>'),
            "quot" => out.push('"'),
            "apos" => out.push('\''),
            _ => {
                let digits = name.strip_prefix('#').ok_or(Reason::UnsupportedFormat)?;
                let code = match digits.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16),
                    None => digits.parse::<u32>(),
                }
                .map_err(|_| Reason::UnsupportedFormat)?;
                let c = char::from_u32(code).ok_or(Reason::UnsupportedFormat)?;
                // The characters XML allows.
                if !(matches!(c, '\t' | '\n' | '\r')
                    || c >= ' ' && c != '\u{FFFE}' && c != '\u{FFFF}')
                {
                    return Err(Reason::UnsupportedFormat);
                }
                out.push(c);
            }
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// `#id` and nothing else.
fn fragment(value: &str) -> Option<&str> {
    let id = value.strip_prefix('#')?;
    let ok = !id.is_empty()
        && !id
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '#' | '(' | ')' | '\'' | '"' | '\\' | ';'));
    ok.then_some(id)
}

/// Every reference inside a value: an import is external, and so is every `url(...)` that is not `url(#id)`.
/// Returns the ids referenced.
fn scan_references(value: &str) -> Result<Vec<String>, Reason> {
    let lower = value.to_ascii_lowercase();
    if lower.contains("@import") {
        return Err(Reason::SvgExternalReference);
    }
    let mut ids = Vec::new();
    let mut from = 0;
    while let Some(found) = lower[from..].find("url(") {
        let mut at = from + found + 4;
        let bytes = value.as_bytes();
        let skip_space = |at: &mut usize| {
            while *at < bytes.len() && bytes[*at].is_ascii_whitespace() {
                *at += 1;
            }
        };
        skip_space(&mut at);
        let quote = match bytes.get(at) {
            Some(q @ (b'\'' | b'"')) => {
                at += 1;
                Some(*q)
            }
            _ => None,
        };
        if bytes.get(at) != Some(&b'#') {
            return Err(Reason::SvgExternalReference);
        }
        let start = at + 1;
        let mut end = start;
        while end < bytes.len()
            && !bytes[end].is_ascii_whitespace()
            && !matches!(bytes[end], b')' | b'\'' | b'"')
        {
            end += 1;
        }
        if end == start {
            return Err(Reason::SvgExternalReference);
        }
        ids.push(value[start..end].to_owned());
        at = end;
        if let Some(q) = quote {
            if bytes.get(at) != Some(&q) {
                return Err(Reason::SvgExternalReference);
            }
            at += 1;
        }
        skip_space(&mut at);
        if bytes.get(at) != Some(&b')') {
            return Err(Reason::SvgExternalReference);
        }
        from = at + 1;
    }
    Ok(ids)
}

fn is_event_handler(local: &str) -> bool {
    local.len() > 2 && local.as_bytes()[..2].eq_ignore_ascii_case(b"on")
}

impl Reader {
    fn token(&mut self, token: Token<'_>) -> Result<(), Reason> {
        match token {
            Token::Declaration { encoding, .. } => {
                if let Some(encoding) = encoding
                    && !encoding.as_str().eq_ignore_ascii_case("utf-8")
                {
                    return Err(Reason::UnsupportedFormat);
                }
            }
            Token::ProcessingInstruction { target, .. } => {
                return Err(if target.as_str().eq_ignore_ascii_case("xml-stylesheet") {
                    Reason::SvgExternalReference
                } else {
                    Reason::SvgNotAllowed
                });
            }
            Token::DtdStart { .. } | Token::EmptyDtd { .. } | Token::EntityDeclaration { .. } => {
                return Err(Reason::SvgDoctype);
            }
            Token::DtdEnd { .. } => return Err(Reason::SvgDoctype),
            Token::Comment { .. } => {}
            Token::ElementStart { prefix, local, .. } => {
                self.element_start(prefix.as_str(), local.as_str())?;
            }
            Token::Attribute {
                prefix,
                local,
                value,
                ..
            } => self.attribute(prefix.as_str(), local.as_str(), value.as_str())?,
            Token::ElementEnd { end, .. } => match end {
                ElementEnd::Open => self.element_open()?,
                ElementEnd::Empty => {
                    self.element_open()?;
                    self.element_close()?;
                }
                ElementEnd::Close(_, _) => self.element_close()?,
            },
            Token::Text { text } => {
                let decoded = decode(text.as_str())?;
                self.text(decoded)?;
            }
            Token::Cdata { text, .. } => self.text(text.as_str().to_owned())?,
        }
        Ok(())
    }

    fn element_start(&mut self, prefix: &str, local: &str) -> Result<(), Reason> {
        if self.open.is_some() {
            return Err(Reason::UnsupportedFormat); // a start inside a start: the tokenizer does not allow it
        }
        if local.eq_ignore_ascii_case("script") {
            return Err(Reason::SvgScript);
        }
        if local.eq_ignore_ascii_case("foreignObject") {
            return Err(Reason::SvgForeignObject);
        }
        if self.stack.is_empty() && (self.root_seen || !prefix.is_empty() || local != "svg") {
            return Err(Reason::UnsupportedFormat); // a second root, or a document that is not an SVG
        }
        self.elements += 1;
        if self.elements > MAX_SVG_ELEMENTS {
            return Err(Reason::TooManyElements);
        }
        if self.stack.len() >= MAX_DEPTH {
            return Err(Reason::SvgNotAllowed);
        }
        let name = if prefix.is_empty() {
            ELEMENTS.iter().find(|e| **e == local).copied()
        } else {
            None
        };
        self.open = Some(Open {
            name,
            attrs: Vec::new(),
            seen: Vec::new(),
            style: prefix.is_empty() && local == "style",
        });
        Ok(())
    }

    fn attribute(&mut self, prefix: &str, local: &str, raw: &str) -> Result<(), Reason> {
        let Some(open) = self.open.as_mut() else {
            return Err(Reason::UnsupportedFormat);
        };
        let written = format!("{prefix}:{local}");
        if open.seen.contains(&written) {
            return Err(Reason::UnsupportedFormat);
        }
        open.seen.push(written);
        let strict = open.name.is_some();
        let value = decode(raw)?;

        // Namespace declarations are dropped: the output declares the SVG namespace itself and uses no other.
        // The default namespace and `xlink` may not be bound to anything else; any other prefix that is
        // declared and then used makes the element or attribute that uses it "not allowed" on its own.
        if prefix == "xmlns" || (prefix.is_empty() && local == "xmlns") {
            let bound_elsewhere = match (prefix, local) {
                ("", _) => value != SVG_NS,
                (_, "xlink") => value != XLINK_NS,
                _ => false,
            };
            return if strict && bound_elsewhere {
                Err(Reason::SvgNotAllowed)
            } else {
                Ok(())
            };
        }

        if is_event_handler(local) {
            return Err(Reason::SvgEventHandler);
        }
        // Whatever the attribute is, nothing in it may refer outside the file.
        let ids = scan_references(&value)?;

        let is_href = local == "href" && (prefix.is_empty() || prefix == "xlink");
        if is_href {
            let id = fragment(&value).ok_or(Reason::SvgExternalReference)?;
            self.references.push(id.to_owned());
            self.set("href", value.clone());
            return Ok(());
        }
        if !strict {
            return Ok(()); // the element will be refused when its start tag ends
        }
        self.references.extend(ids);
        if prefix == "xml" && local == "space" {
            return if matches!(value.as_str(), "default" | "preserve") {
                self.set("xml:space", value);
                Ok(())
            } else {
                Err(Reason::SvgNotAllowed)
            };
        }
        if !prefix.is_empty() {
            return Err(Reason::SvgNotAllowed);
        }
        if local == "style" {
            return self.style_attribute(&value);
        }
        let name = STRUCTURE
            .iter()
            .chain(PRESENTATION)
            .find(|a| **a == local)
            .ok_or(Reason::SvgNotAllowed)?;
        self.checked_value(&value)?;
        self.set(name, value);
        Ok(())
    }

    /// A value that a renderer might read as something other than a plain value.
    fn checked_value(&self, value: &str) -> Result<(), Reason> {
        if value.contains('\\') || value.contains("/*") {
            return Err(Reason::SvgNotAllowed);
        }
        Ok(())
    }

    fn set(&mut self, name: &'static str, value: String) {
        if let Some(open) = self.open.as_mut() {
            match open.attrs.iter_mut().find(|(n, _)| *n == name) {
                Some(slot) => slot.1 = value,
                None => open.attrs.push((name, value)),
            }
        }
    }

    /// Declarations of a `style` attribute: presentation properties become attributes (they win over an
    /// attribute of the same name, as in CSS); the one Illustrator property that means nothing here is
    /// dropped; anything else is refused.
    fn style_attribute(&mut self, value: &str) -> Result<(), Reason> {
        for declaration in value.split(';') {
            let declaration = declaration.trim();
            if declaration.is_empty() {
                continue;
            }
            let (property, content) = declaration.split_once(':').ok_or(Reason::SvgNotAllowed)?;
            let property = property.trim().to_ascii_lowercase();
            let content = content.trim();
            if property == "enable-background" {
                continue;
            }
            let name = PRESENTATION
                .iter()
                .find(|p| **p == property)
                .ok_or(Reason::SvgNotAllowed)?;
            if content.is_empty() || content.to_ascii_lowercase().contains("!important") {
                return Err(Reason::SvgNotAllowed);
            }
            self.checked_value(content)?;
            self.set(name, content.to_owned());
        }
        Ok(())
    }

    fn element_open(&mut self) -> Result<(), Reason> {
        let open = self.open.take().ok_or(Reason::UnsupportedFormat)?;
        if self.in_style {
            // An element inside a `<style>` is not CSS text: refused where it starts. Going on would push it under
            // the `usize::MAX` that stands for the `<style>` and index out of bounds (security review F3). The
            // `<style>` itself is refused when it closes, or earlier for its `@import` (`text`).
            return Err(Reason::SvgNotAllowed);
        }
        let Some(name) = open.name else {
            if open.style {
                // Read its text for an import first; refused when it closes.
                self.in_style = true;
                self.stack.push(usize::MAX);
                return Ok(());
            }
            return Err(Reason::SvgNotAllowed);
        };
        let index = self.nodes.len();
        if let Some((_, id)) = open.attrs.iter().find(|(n, _)| *n == "id") {
            self.ids.entry(id.clone()).or_insert(index);
        }
        self.nodes.push(Node {
            name,
            attrs: open.attrs,
            children: Vec::new(),
        });
        if let Some(parent) = self.stack.last() {
            self.nodes[*parent].children.push(Child::Element(index));
        } else {
            self.root_seen = true;
            if name != "svg" {
                return Err(Reason::UnsupportedFormat); // XML, but not an SVG
            }
        }
        self.stack.push(index);
        Ok(())
    }

    fn element_close(&mut self) -> Result<(), Reason> {
        if self.in_style {
            return Err(Reason::SvgNotAllowed);
        }
        self.stack.pop().ok_or(Reason::UnsupportedFormat)?;
        Ok(())
    }

    fn text(&mut self, text: String) -> Result<(), Reason> {
        if self.in_style {
            scan_references(&text)?;
            return Ok(());
        }
        if self.open.is_some() {
            return Err(Reason::UnsupportedFormat);
        }
        let Some(&current) = self.stack.last() else {
            // Outside the root: only whitespace.
            return if text.trim().is_empty() {
                Ok(())
            } else {
                Err(Reason::UnsupportedFormat)
            };
        };
        if TEXT_ELEMENTS.contains(&self.nodes[current].name) {
            self.nodes[current].children.push(Child::Text(text));
            Ok(())
        } else if text.trim().is_empty() {
            Ok(())
        } else {
            Err(Reason::SvgNotAllowed)
        }
    }

    /// The document is complete: check what needs all of it, then write it out.
    fn finish(self) -> Result<Vec<u8>, Reason> {
        if !self.stack.is_empty() || self.nodes.is_empty() {
            return Err(Reason::UnsupportedFormat);
        }
        for id in &self.references {
            if !self.ids.contains_key(id) {
                return Err(Reason::SvgExternalReference);
            }
        }
        self.check_uses()?;
        let mut out = String::new();
        self.write(0, 0, &mut out);
        Ok(out.into_bytes())
    }

    /// A `<use>` stands for its target's elements; the target holds no `<use>`; the total stays bounded.
    fn check_uses(&self) -> Result<(), Reason> {
        // Children come after their parent, so one backward pass gives every subtree.
        let count = self.nodes.len();
        let mut size = vec![1usize; count];
        let mut has_use = vec![false; count];
        for index in (0..count).rev() {
            has_use[index] |= self.nodes[index].name == "use";
            for child in &self.nodes[index].children {
                if let Child::Element(c) = child {
                    size[index] += size[*c];
                    has_use[index] |= has_use[*c];
                }
            }
        }
        let mut total = count;
        for node in &self.nodes {
            if node.name != "use" {
                continue;
            }
            let Some((_, href)) = node.attrs.iter().find(|(n, _)| *n == "href") else {
                continue;
            };
            let target = *href
                .strip_prefix('#')
                .and_then(|id| self.ids.get(id))
                .ok_or(Reason::SvgExternalReference)?;
            if has_use[target] {
                return Err(Reason::SvgNotAllowed);
            }
            total += size[target];
            if total > MAX_SVG_ELEMENTS {
                return Err(Reason::TooManyElements);
            }
        }
        Ok(())
    }

    fn write(&self, index: usize, depth: usize, out: &mut String) {
        let node = &self.nodes[index];
        out.push('<');
        out.push_str(node.name);
        if depth == 0 {
            out.push_str(" xmlns=\"");
            out.push_str(SVG_NS);
            out.push('"');
        }
        for (name, value) in &node.attrs {
            out.push(' ');
            out.push_str(name);
            out.push_str("=\"");
            escape(value, true, out);
            out.push('"');
        }
        if node.children.is_empty() {
            out.push_str("/>");
            return;
        }
        out.push('>');
        for child in &node.children {
            match child {
                Child::Element(c) => self.write(*c, depth + 1, out),
                Child::Text(text) => escape(text, false, out),
            }
        }
        out.push_str("</");
        out.push_str(node.name);
        out.push('>');
    }
}

fn escape(text: &str, attribute: bool, out: &mut String) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' if attribute => out.push_str("&quot;"),
            '\t' if attribute => out.push_str("&#9;"),
            '\n' if attribute => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            other => out.push(other),
        }
    }
}
