//! letterhead-engine — the pure core of letterhead-api.
//!
//! Content model and validation, placeholder resolution, the layouts and the outputs (PDF, preview pages,
//! page text) are added here by the tasks that follow the skeleton (T2 onwards). This crate stays free of
//! I/O: no file system, no network, no clock, no process, no environment, no async runtime. Everything it
//! needs is in its arguments. That is what makes the determinism of AC-1.4 and the closed file system of
//! AC-2.2 provable, and why a worker process can run it with an empty environment.
//!
//! The test below is a tripwire for that rule, not a proof of it: it fails when a dependency or a source line
//! that does I/O appears. Where the rule is truly in the way, change the rule in AGENTS.md first.

#![forbid(unsafe_code)]

pub mod assets;
pub mod config;
pub mod content;
pub mod layout;
pub mod output;
pub mod render;
pub mod resolve;
pub mod sample;
pub mod world;

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Crates that reach outside the process. Built from pieces so this file does not trip its own check.
    fn forbidden_crates() -> Vec<String> {
        [
            "tokio",
            "async-std",
            "axum",
            "hyper",
            "reqwest",
            "sqlx",
            "aws-sdk-s3",
            "aws-config",
            "libc",
            "rustix",
        ]
        .map(String::from)
        .to_vec()
    }

    /// Paths and calls that reach outside the process, split in two so that this file does not contain them whole.
    fn forbidden_code() -> Vec<String> {
        [
            ("std::", "fs"),
            ("std::", "net"),
            ("std::", "process"),
            ("std::", "env"),
            ("std::", "thread"),
            ("std::time::", "SystemTime"),
            ("Instant", "::now"),
            ("File", "::open"),
        ]
        .map(|(a, b)| format!("{a}{b}"))
        .to_vec()
    }

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(dir).expect("read src dir") {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    #[test]
    fn the_engine_does_no_io() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));

        let manifest = fs::read_to_string(root.join("Cargo.toml")).expect("read Cargo.toml");
        let dependencies = manifest
            .split("[dependencies]")
            .nth(1)
            .map(|rest| rest.split("\n[").next().unwrap_or(rest))
            .unwrap_or_default();
        for name in forbidden_crates() {
            assert!(
                !dependencies
                    .lines()
                    .any(|line| line.trim_start().starts_with(&name)),
                "engine/Cargo.toml depends on `{name}`: the engine does no I/O (AGENTS.md)"
            );
        }

        let mut files = Vec::new();
        rust_files(&root.join("src"), &mut files);
        assert!(!files.is_empty());
        for file in files {
            let source = fs::read_to_string(&file).expect("read source");
            // This file's own test module necessarily mentions the rule; judge the code above it.
            let code = source.split("#[cfg(test)]").next().unwrap_or(&source);
            for pattern in forbidden_code() {
                assert!(
                    !code.contains(&pattern),
                    "{} uses `{pattern}`: the engine does no I/O (AGENTS.md, Rust service)",
                    file.display()
                );
            }
        }
    }
}
