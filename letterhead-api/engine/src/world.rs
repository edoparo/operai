//! The virtual Typst World of a render (task T5; AC-2.2, AC-7.5; spike F6, F7).
//!
//! A render sees a closed set of "files", all of them buffers handed in by the caller of the engine:
//!
//! - `/main.typ`, the layout's template, compiled into the binary;
//! - `/data.json`, the request and the letterhead's configuration turned into data;
//! - `/img/<n>.<ext>`, the images of the request, numbered in the order of their blocks;
//! - `/asset/<n>.<ext>`, the logos and backgrounds of the letterhead version, numbered by slot.
//!
//! `<ext>` is the format sniffed from the bytes, never from a name (F6: Typst chooses its decoder by the
//! extension). The numbers come from a fixed range, never from a request's text, because every distinct path
//! that Typst is asked for is interned for the life of the process, 65 535 at most (F7).
//!
//! Anything else is [`FileError::AccessDenied`], and every access, served or denied, is logged, so a test can
//! compare the log with the allowed set. There is **no font path**: the fonts are the ones the layout was built
//! with, and no `typst-kit` (system fonts, packages, downloads) is linked. `today()` is `None`: the clock is
//! not an input of a render (AC-1.4).

use std::collections::HashMap;
use std::sync::Mutex;

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

use crate::assets::Format;
use crate::layout::Shared;

/// The data file of every render.
pub const DATA_PATH: &str = "/data.json";

/// How many files of each family a render may name. An image block is a block, and a request has at most
/// 5 000 blocks (AC-3.3); a letterhead has at most three variants with a logo and a background each.
pub const MAX_IMAGES: usize = 5_000;
pub const MAX_ASSET_SLOTS: usize = 6;

/// The extension that Typst picks a decoder by.
pub fn extension(format: Format) -> &'static str {
    match format {
        Format::Png => "png",
        Format::Jpeg => "jpg",
        Format::Svg => "svg",
    }
}

/// `/img/<n>.<ext>`.
pub fn image_path(n: usize, format: Format) -> String {
    format!("/img/{n}.{}", extension(format))
}

/// `/asset/<n>.<ext>`.
pub fn asset_path(slot: usize, format: Format) -> String {
    format!("/asset/{slot}.{}", extension(format))
}

/// The format of stored bytes, from the bytes. Stored images were checked on the way in
/// ([`crate::assets::ingest`]): anything that is not a PNG or a JPEG is an SVG.
pub fn sniff(bytes: &[u8]) -> Format {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Format::Png
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Format::Jpeg
    } else {
        Format::Svg
    }
}

/// One access to the file system of the World.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Access {
    /// The path asked for, with its leading slash; a package path is written `package:<spec>/<path>`.
    pub path: String,
    /// `false`: refused.
    pub served: bool,
}

/// The id of a path of the project root. Only paths of the fixed set are ever built (F7).
fn file_id(path: &str) -> FileId {
    let vpath = VirtualPath::new(path).expect("a path of the fixed set is a valid virtual path");
    RootedPath::new(VirtualRoot::Project, vpath).intern()
}

fn describe(id: FileId) -> String {
    match id.root() {
        VirtualRoot::Project => id.vpath().get_with_slash().to_owned(),
        VirtualRoot::Package(package) => {
            format!("package:{package:?}{}", id.vpath().get_with_slash())
        }
    }
}

/// The World of one render.
pub struct LayoutWorld<'a> {
    shared: &'a Shared,
    files: HashMap<FileId, Bytes>,
    log: Mutex<Vec<Access>>,
}

impl<'a> LayoutWorld<'a> {
    pub(crate) fn new(shared: &'a Shared, files: Vec<(String, Vec<u8>)>) -> LayoutWorld<'a> {
        let files = files
            .into_iter()
            .map(|(path, bytes)| (file_id(&path), Bytes::new(bytes)))
            .collect();
        LayoutWorld {
            shared,
            files,
            log: Mutex::new(Vec::new()),
        }
    }

    /// Every access so far, in order.
    pub fn accesses(&self) -> Vec<Access> {
        self.log
            .lock()
            .expect("the access log is never poisoned")
            .clone()
    }

    fn record(&self, id: FileId, served: bool) {
        self.log
            .lock()
            .expect("the access log is never poisoned")
            .push(Access {
                path: describe(id),
                served,
            });
    }
}

impl World for LayoutWorld<'_> {
    fn library(&self) -> &LazyHash<Library> {
        &self.shared.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.shared.book
    }

    fn main(&self) -> FileId {
        self.shared.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.shared.main {
            return Ok(self.shared.source.clone());
        }
        // The template imports nothing: any other source is somebody trying to read a file.
        self.record(id, false);
        Err(FileError::AccessDenied)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        match self.files.get(&id) {
            Some(bytes) => {
                self.record(id, true);
                Ok(bytes.clone())
            }
            None => {
                self.record(id, false);
                Err(FileError::AccessDenied)
            }
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.shared.fonts.get(index).cloned()
    }

    fn today(&self, _: Option<typst::foundations::Duration>) -> Option<Datetime> {
        None
    }
}

/// The library of a layout: Typst's standard library, no features beyond the default.
pub(crate) fn library() -> LazyHash<Library> {
    LazyHash::new(Library::default())
}

/// The id of the template, which is not in the file set.
pub(crate) fn main_id() -> FileId {
    file_id("/main.typ")
}

/// The id of an arbitrary path of the project root, for tests that ask the World for something it must refuse.
#[cfg(test)]
pub(crate) fn id_of(path: &str) -> FileId {
    file_id(path)
}

#[cfg(test)]
mod tests;
