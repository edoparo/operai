//! `sqlx::migrate!("./migrations")` embeds the migration files at compile time, and a proc macro cannot watch a
//! directory: a *new* file would not trigger a rebuild, and the binary (`letterhead-api migrate`) would ship
//! without it. This line makes Cargo re-run the build, and so recompile the crate, when anything in the
//! directory changes (amendment 2026-11-17, item 4).

fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
