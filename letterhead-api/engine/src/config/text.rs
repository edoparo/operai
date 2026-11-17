//! The text of a header or footer line: placeholders, literal escapes and conditional segments
//! (AC-5.7, 6.1, 6.2, 6.6; ported from the spike's `resolve.rs`).
//!
//! | You write | It means |
//! | --- | --- |
//! | `{name}` | a placeholder; `name` is one of [`Placeholder::ALL`] |
//! | `{{` `}}` | a literal `{` and `}` |
//! | `[[` `]]` | a literal `[` and `]` |
//! | `[text {name} text]` | a conditional segment: printed, without its brackets, only when every
//! placeholder inside it has a value |
//!
//! The text is read left to right and each pair is taken as soon as it is seen, so `{{{page}}}` is a
//! literal `{`, the page number, and a literal `}`. So `[{vat}]]` is not a segment followed by a bracket:
//! its `]]` is a literal and the segment is never closed; to print a bracket right after a segment, put
//! something between them (`[{vat}] ]]`). A segment needs a placeholder and cannot hold another segment.
//! The first fault is the one reported: one problem per text.

use super::problem::{Reason, shown};

/// The closed set of placeholders (AC-6.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Placeholder {
    LegalName,
    Address,
    Vat,
    Iban,
    Contacts,
    /// The page's own number. Never read from the entity data: the layout fills it per page.
    Page,
    /// The document's page count.
    Pages,
}

impl Placeholder {
    pub const ALL: [Placeholder; 7] = [
        Placeholder::LegalName,
        Placeholder::Address,
        Placeholder::Vat,
        Placeholder::Iban,
        Placeholder::Contacts,
        Placeholder::Page,
        Placeholder::Pages,
    ];

    /// The name written between braces.
    pub fn name(self) -> &'static str {
        match self {
            Placeholder::LegalName => "legal_name",
            Placeholder::Address => "address",
            Placeholder::Vat => "vat",
            Placeholder::Iban => "iban",
            Placeholder::Contacts => "contacts",
            Placeholder::Page => "page",
            Placeholder::Pages => "pages",
        }
    }

    pub fn parse(name: &str) -> Option<Placeholder> {
        Placeholder::ALL.into_iter().find(|p| p.name() == name)
    }

    /// `{page}` and `{pages}`: filled by the layout, never missing (AC-5.7).
    pub fn is_page(self) -> bool {
        matches!(self, Placeholder::Page | Placeholder::Pages)
    }
}

/// A part of a parsed text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Literal(String),
    Placeholder(Placeholder),
    /// A conditional segment. It holds only [`Token::Literal`] and [`Token::Placeholder`], and at least one
    /// placeholder.
    Segment(Vec<Token>),
}

/// The first fault of a text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextError {
    pub reason: Reason,
    /// The unknown placeholder's name, or the unbalanced brace or bracket, as typed (cut to a bounded length).
    pub name: Option<String>,
}

fn fault(reason: Reason, name: impl Into<String>) -> TextError {
    TextError {
        reason,
        name: Some(shown(&name.into())),
    }
}

fn bare(reason: Reason) -> TextError {
    TextError { reason, name: None }
}

fn push_literal(target: &mut Vec<Token>, c: char) {
    if let Some(Token::Literal(text)) = target.last_mut() {
        text.push(c);
    } else {
        target.push(Token::Literal(c.to_string()));
    }
}

/// Read one line's text.
pub fn parse_text(text: &str) -> Result<Vec<Token>, TextError> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<Token> = Vec::new();
    let mut segment: Option<Vec<Token>> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        // Where this token goes: the open segment, or the line.
        let target = match segment.as_mut() {
            Some(open) => open,
            None => &mut out,
        };
        match c {
            '{' | '}' | '[' | ']' if next == Some(c) => {
                push_literal(target, c);
                i += 2;
            }
            '{' => {
                let Some(end) = chars[i + 1..].iter().position(|x| *x == '}') else {
                    return Err(fault(Reason::UnbalancedBrace, "{"));
                };
                let end = i + 1 + end;
                let name: String = chars[i + 1..end].iter().collect();
                let Some(placeholder) = Placeholder::parse(&name) else {
                    return Err(fault(Reason::UnknownPlaceholder, name));
                };
                target.push(Token::Placeholder(placeholder));
                i = end + 1;
            }
            '}' => return Err(fault(Reason::UnbalancedBrace, "}")),
            '[' => {
                if segment.is_some() {
                    return Err(bare(Reason::SegmentNested));
                }
                segment = Some(Vec::new());
                i += 1;
            }
            ']' => {
                let Some(inner) = segment.take() else {
                    return Err(fault(Reason::UnbalancedBracket, "]"));
                };
                if !inner.iter().any(|t| matches!(t, Token::Placeholder(_))) {
                    return Err(bare(Reason::SegmentNoPlaceholder));
                }
                out.push(Token::Segment(inner));
                i += 1;
            }
            other => {
                push_literal(target, other);
                i += 1;
            }
        }
    }
    if segment.is_some() {
        return Err(fault(Reason::UnbalancedBracket, "["));
    }
    Ok(out)
}
