//! The one log line of every render and every refusal (task T12; AC-3.2, AC-3.7).
//!
//! ```text
//! render route=preview caller=system:crm-api entity=welld_it outcome=ok status=200 pages=4 ms=118
//! render route=pdf caller=- entity=- outcome=unauthorized status=401 pages=- ms=0 cause=expired
//! ```
//!
//! It holds the verified caller, the entity, the outcome code, the page count and the duration, and nothing of
//! the content or of the entity data: every field is either a number, a member of a closed list written in this
//! crate (route, entity, outcome, cause), or the caller's service identity, which comes from a signed token and
//! is cut to a safe alphabet and length here so that it cannot add a line of its own. There is no way to put a
//! request's text into a [`Facts`], so there is none into the line.
//!
//! Stdout, one `println!` per line (the standard library locks it for the line): nothing is written to a file
//! (AC-3.7), and there are no metrics or traces to configure.

use std::time::Duration;

/// What the handler (or the authentication) learned about one request, handed to the logger in the response's
/// extensions. Every member is optional: a refusal before the caller or the entity is known has neither.
#[derive(Debug, Clone, Default)]
pub struct Facts {
    /// The verified `sub` of the service token; `None` when nothing was verified.
    pub caller: Option<String>,
    /// `welld_it` or `welld_ch`, once the request has been read far enough to know.
    pub entity: Option<&'static str>,
    pub pages: Option<usize>,
    /// The outcome code: `ok`, or the `code` of the refusal, or an internal one for a server fault. A closed list
    /// in this crate.
    pub outcome: Option<&'static str>,
    /// Why, in a closed vocabulary, for the outcomes where an operator needs it (`unauthorized`).
    pub cause: Option<&'static str>,
}

/// The route a line is about: the fixed names of the service routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Preview,
    Pdf,
    Status,
}

impl Route {
    pub fn as_str(self) -> &'static str {
        match self {
            Route::Preview => "preview",
            Route::Pdf => "pdf",
            Route::Status => "status",
        }
    }

    /// The route of a path that the service router matched.
    pub fn of_path(path: &str) -> Option<Route> {
        match path {
            "/v1/render/preview" => Some(Route::Preview),
            "/v1/render/pdf" => Some(Route::Pdf),
            "/v1/letterheads/status" => Some(Route::Status),
            _ => None,
        }
    }
}

/// The longest caller identity that is written.
const MAX_CALLER_CHARS: usize = 80;

/// A service identity, safe to put in a line: letters, digits and `: _ . @ -`, at most 80 characters. Anything
/// else (a space, a newline, `=`) becomes `?`, so the field is one token and cannot start another.
fn token(caller: &str) -> String {
    let mut out: String = caller
        .chars()
        .take(MAX_CALLER_CHARS)
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '.' | '@' | '-') {
                c
            } else {
                '?'
            }
        })
        .collect();
    if out.is_empty() {
        out.push('-');
    }
    out
}

/// The line, without its newline.
pub fn format_line(route: Route, facts: &Facts, status: u16, elapsed: Duration) -> String {
    let pages = facts
        .pages
        .map_or_else(|| "-".to_owned(), |pages| pages.to_string());
    let mut line = format!(
        "render route={} caller={} entity={} outcome={} status={status} pages={pages} ms={}",
        route.as_str(),
        facts
            .caller
            .as_deref()
            .map_or_else(|| "-".to_owned(), token),
        facts.entity.unwrap_or("-"),
        facts.outcome.unwrap_or("-"),
        elapsed.as_millis(),
    );
    if let Some(cause) = facts.cause {
        line.push_str(" cause=");
        line.push_str(cause);
    }
    line
}

/// Writes the line to stdout.
pub fn emit(line: &str) {
    println!("{line}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> Facts {
        Facts {
            caller: Some("system:crm-api".into()),
            entity: Some("welld_it"),
            pages: Some(4),
            outcome: Some("ok"),
            cause: None,
        }
    }

    #[test]
    fn a_line_holds_the_caller_entity_outcome_pages_and_duration() {
        let line = format_line(Route::Preview, &facts(), 200, Duration::from_millis(118));
        assert_eq!(
            line,
            "render route=preview caller=system:crm-api entity=welld_it outcome=ok status=200 pages=4 ms=118"
        );
    }

    #[test]
    fn a_refusal_before_anything_is_known_has_dashes() {
        let facts = Facts {
            outcome: Some("unauthorized"),
            cause: Some("expired"),
            ..Facts::default()
        };
        let line = format_line(Route::Pdf, &facts, 401, Duration::from_millis(0));
        assert_eq!(
            line,
            "render route=pdf caller=- entity=- outcome=unauthorized status=401 pages=- ms=0 cause=expired"
        );
    }

    #[test]
    fn a_caller_cannot_add_fields_or_lines() {
        let facts = Facts {
            caller: Some("system:x entity=welld_ch\noutcome=ok\r\n".into()),
            ..facts()
        };
        let line = format_line(Route::Pdf, &facts, 200, Duration::ZERO);
        assert!(!line.contains('\n') && !line.contains('\r'), "{line:?}");
        assert!(line.contains("caller=system:x?entity?welld_ch?outcome?ok??"));
        assert_eq!(line.matches("entity=").count(), 1, "{line}");
        assert_eq!(line.matches("outcome=").count(), 1, "{line}");
    }

    #[test]
    fn a_long_caller_is_cut() {
        let facts = Facts {
            caller: Some(format!("system:{}", "a".repeat(500))),
            ..facts()
        };
        let line = format_line(Route::Pdf, &facts, 200, Duration::ZERO);
        let caller = line
            .split("caller=")
            .nth(1)
            .and_then(|r| r.split(' ').next());
        assert_eq!(caller.map(str::len), Some(MAX_CALLER_CHARS));
    }

    #[test]
    fn the_routes_of_the_service_are_named_and_nothing_else_is() {
        assert_eq!(Route::of_path("/v1/render/preview"), Some(Route::Preview));
        assert_eq!(Route::of_path("/v1/render/pdf"), Some(Route::Pdf));
        assert_eq!(
            Route::of_path("/v1/letterheads/status"),
            Some(Route::Status)
        );
        assert_eq!(Route::of_path("/v1/render/pdf/secret-marker"), None);
        assert_eq!(Route::of_path("/health"), None);
    }
}
