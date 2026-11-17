//! PNG and JPEG: the container is read, the size is judged from the header, nothing is decoded.

use super::{MAX_PIXELS, Reason};

/// CRC-32 (the PNG polynomial), bitwise: chunks are few, so no table.
pub(super) fn crc32(parts: &[&[u8]]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for part in parts {
        for byte in *part {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
    }
    !crc
}

fn be32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn be16(bytes: &[u8]) -> usize {
    usize::from(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn check_pixels(width: u32, height: u32) -> Result<(), Reason> {
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        Err(Reason::TooManyPixels)
    } else {
        Ok(())
    }
}

/// A PNG: signature, then IHDR first (and once), chunks whose checksums hold, at least one IDAT, and IEND.
/// Returns the pixel size from IHDR, which is checked against the bound before the rest is read.
pub(super) fn png(data: &[u8]) -> Result<(u32, u32), Reason> {
    let bad = Reason::UnsupportedFormat;
    let mut pos = 8; // after the signature, which the caller matched
    let mut size = None;
    let mut idat = false;
    let mut first = true;
    loop {
        if data.len() < pos + 12 {
            return Err(bad); // truncated: no IEND
        }
        let length = be32(&data[pos..]) as usize;
        let kind = &data[pos + 4..pos + 8];
        let end = pos
            .checked_add(12)
            .and_then(|n| n.checked_add(length))
            .ok_or(bad)?;
        if length > 0x7FFF_FFFF || end > data.len() {
            return Err(bad);
        }
        let body = &data[pos + 8..pos + 8 + length];
        if be32(&data[pos + 8 + length..]) != crc32(&[kind, body]) {
            return Err(bad);
        }
        if first {
            // IHDR comes first and holds the size.
            if kind != b"IHDR" || length != 13 {
                return Err(bad);
            }
            let (width, height) = (be32(&body[0..]), be32(&body[4..]));
            if width == 0 || height == 0 || width > 0x7FFF_FFFF || height > 0x7FFF_FFFF {
                return Err(bad);
            }
            let (depth, colour, compression, filter, interlace) =
                (body[8], body[9], body[10], body[11], body[12]);
            let depth_ok = match colour {
                0 => matches!(depth, 1 | 2 | 4 | 8 | 16),
                3 => matches!(depth, 1 | 2 | 4 | 8),
                2 | 4 | 6 => matches!(depth, 8 | 16),
                _ => false,
            };
            if !depth_ok || compression != 0 || filter != 0 || interlace > 1 {
                return Err(bad);
            }
            check_pixels(width, height)?;
            size = Some((width, height));
            first = false;
        } else {
            match kind {
                b"IHDR" => return Err(bad),
                b"IDAT" => idat = true,
                b"IEND" => {
                    if length != 0 || !idat {
                        return Err(bad);
                    }
                    return size.ok_or(bad);
                }
                _ => {}
            }
        }
        pos = end;
    }
}

/// A JPEG: SOI, segments with sound lengths, exactly one frame header (baseline, extended or progressive)
/// before the first scan, and EOI. The size is from that frame header, checked before the rest is read; a
/// second frame header anywhere is refused, so no later "header" can say something else than the first.
pub(super) fn jpeg(data: &[u8]) -> Result<(u32, u32), Reason> {
    let bad = Reason::UnsupportedFormat;
    let mut pos = 2; // after SOI
    let mut size: Option<(u32, u32)> = None;
    let mut in_scan = false;
    while pos < data.len() {
        if data[pos] != 0xFF {
            if in_scan {
                pos += 1; // entropy-coded data
                continue;
            }
            return Err(bad);
        }
        // A marker: 0xFF, any number of fill 0xFF, then the code.
        let mut at = pos + 1;
        while at < data.len() && data[at] == 0xFF {
            at += 1;
        }
        let Some(&code) = data.get(at) else {
            return Err(bad);
        };
        match code {
            0x00 => {
                // A stuffed 0xFF inside entropy-coded data.
                if !in_scan {
                    return Err(bad);
                }
                pos = at + 1;
            }
            0xD0..=0xD7 | 0x01 => {
                // Restart markers and TEM carry no length.
                pos = at + 1;
            }
            0xD8 => return Err(bad),
            0xD9 => {
                return if size.is_some() {
                    size.ok_or(bad)
                } else {
                    Err(bad)
                };
            }
            _ => {
                let length_at = at + 1;
                if data.len() < length_at + 2 {
                    return Err(bad);
                }
                let length = be16(&data[length_at..]);
                let end = length_at + length;
                if length < 2 || end > data.len() {
                    return Err(bad);
                }
                let segment = &data[length_at + 2..end];
                match code {
                    0xC0..=0xCF if !matches!(code, 0xC4 | 0xC8 | 0xCC) => {
                        // Only baseline, extended sequential and progressive DCT.
                        if !matches!(code, 0xC0..=0xC2) || size.is_some() || segment.len() < 6 {
                            return Err(bad);
                        }
                        let height = be16(&segment[1..]) as u32;
                        let width = be16(&segment[3..]) as u32;
                        if width == 0 || height == 0 {
                            return Err(bad);
                        }
                        check_pixels(width, height)?;
                        size = Some((width, height));
                    }
                    0xDA => {
                        if size.is_none() {
                            return Err(bad);
                        }
                        in_scan = true;
                    }
                    _ => {}
                }
                pos = end;
            }
        }
    }
    Err(bad) // no EOI
}
