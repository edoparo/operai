//! The repository of the service (`src/db/repo.rs`, task T10) and its row types, for the render tests: they make
//! their fixtures, versions and assets, through the same functions the service uses (task T12).
//!
//! `api` is a binary crate and an integration test cannot link a binary, so the sources are compiled into the test
//! with `#[path]` (as `pool.rs` does for the worker pool). `tests/render.rs` declares this file as its module `db`.
//! Cargo also finds it as a test target of its own, which has no test in it: it is a file that Cargo would build
//! anyway, so it is kept free of anything that a lone build would warn about.

#![expect(
    dead_code,
    reason = "the repository is compiled in whole; a render test calls the part that it needs, and a build of this file alone calls none"
)]

#[path = "../src/db/repo.rs"]
pub mod repo;
#[path = "../src/db/types.rs"]
pub mod types;
