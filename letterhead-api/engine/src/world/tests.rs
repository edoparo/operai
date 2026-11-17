//! The names of the World's files (task T5). The access log and the closed set are tested with a render in
//! `layout::tests`.

use super::*;

#[test]
fn the_ranges_leave_room_for_every_request_in_the_file_ids_of_a_process() {
    // F7: file ids are interned for good and there are 65 535 of them. Images, asset slots in each of the three
    // formats, plus the template and the data file, are the most a process can ever name.
    let names = MAX_IMAGES * 3 + MAX_ASSET_SLOTS * 3 + 2;
    assert!(names < usize::from(u16::MAX), "{names}");
}

#[test]
fn a_path_is_the_slot_and_the_extension() {
    assert_eq!(asset_path(0, Format::Png), "/asset/0.png");
    assert_eq!(asset_path(5, Format::Svg), "/asset/5.svg");
    assert_eq!(image_path(4999, Format::Jpeg), "/img/4999.jpg");
    assert_eq!(DATA_PATH, "/data.json");
}
