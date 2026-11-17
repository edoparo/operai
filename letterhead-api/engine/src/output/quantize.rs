//! A palette for a page: at most N colours, chosen and applied the same way every time.
//!
//! A preview page is mostly one flat colour with text in a few ramps of anti-aliased greys and the letterhead's
//! colours, so it has few distinct colours and a long run of the same one after another. The quantiser works on
//! the distinct colours with their counts (a weighted median cut that always splits the box with the most
//! squared error, then a few rounds of k-means over the distinct colours), and applies the palette once to each
//! distinct colour. Nothing in it depends on the order of a hash table or on a random state: the colours are
//! sorted before they are used, so one page gives one palette and one picture on every run (AC-1.4).
//!
//! Why not a library: the ones that are good do not fit. `imagequant` is GPL (or commercial); `exoquant` is MIT
//! but counts its colours in a `HashMap` with a random state, so what it does with equal inputs rests on its
//! internals, and it takes about 90 ms for a page where this takes a fraction of that.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// A hasher with no random state: the key is a packed colour.
#[derive(Default)]
struct PackedHasher(u64);

impl Hasher for PackedHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn write_u32(&mut self, value: u32) {
        self.0 = u64::from(value).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }
}

type Counts = HashMap<u32, u32, BuildHasherDefault<PackedHasher>>;

fn pack(r: u8, g: u8, b: u8) -> u32 {
    u32::from(r) << 16 | u32::from(g) << 8 | u32::from(b)
}

fn unpack(c: u32) -> [i32; 3] {
    [
        ((c >> 16) & 255) as i32,
        ((c >> 8) & 255) as i32,
        (c & 255) as i32,
    ]
}

/// Squared distance with the weights of the eye: green counts for more than red, red for more than blue.
fn distance(a: [i32; 3], b: [i32; 3]) -> i64 {
    let (dr, dg, db) = (a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    i64::from(2 * dr * dr + 4 * dg * dg + 3 * db * db)
}

/// A distinct colour and how many pixels have it.
#[derive(Clone, Copy)]
struct Entry {
    rgb: [i32; 3],
    count: i64,
}

/// A set of entries that will share one palette colour.
struct Cell {
    entries: Vec<Entry>,
}

impl Cell {
    fn weight(&self) -> i64 {
        self.entries.iter().map(|e| e.count).sum()
    }

    fn mean(&self) -> [i64; 3] {
        let total = self.weight().max(1);
        let mut sum = [0_i64; 3];
        for e in &self.entries {
            for (s, c) in sum.iter_mut().zip(e.rgb) {
                *s += e.count * i64::from(c);
            }
        }
        // Rounded, not cut: a ground of 255 that a few pixels of 254 are cut into must stay 255.
        let round = |v: i64| (v + total / 2) / total;
        [round(sum[0]), round(sum[1]), round(sum[2])]
    }

    /// The squared error of standing for all of its entries by their mean.
    fn error(&self) -> i64 {
        if self.entries.len() < 2 {
            return 0;
        }
        let mean = self.mean();
        let mean = [mean[0] as i32, mean[1] as i32, mean[2] as i32];
        self.entries
            .iter()
            .map(|e| e.count * distance(e.rgb, mean))
            .sum()
    }

    /// Split in two at the weighted median of the axis with the widest range.
    fn split(mut self) -> (Cell, Cell) {
        let mut low = [255, 255, 255];
        let mut high = [0, 0, 0];
        for e in &self.entries {
            for axis in 0..3 {
                low[axis] = low[axis].min(e.rgb[axis]);
                high[axis] = high[axis].max(e.rgb[axis]);
            }
        }
        // The axes are weighted like the distance, so that the widest is the one that counts the most.
        let weights = [2, 4, 3];
        let axis = (0..3)
            .max_by_key(|&a| (high[a] - low[a]) * weights[a])
            .unwrap_or(1);
        self.entries.sort_by_key(|e| (e.rgb[axis], e.rgb));
        let half = self.weight() / 2;
        let mut seen = 0;
        let mut at = 0;
        for (i, e) in self.entries.iter().enumerate() {
            seen += e.count;
            at = i + 1;
            if seen >= half {
                break;
            }
        }
        // Both halves are never empty.
        let at = at.clamp(1, self.entries.len() - 1);
        let upper = self.entries.split_off(at);
        (
            Cell {
                entries: self.entries,
            },
            Cell { entries: upper },
        )
    }
}

/// The index of the palette colour nearest to `rgb`; the lowest index wins a tie.
fn nearest(palette: &[[i32; 3]], rgb: [i32; 3]) -> usize {
    let mut best = (i64::MAX, 0);
    for (i, &p) in palette.iter().enumerate() {
        let d = distance(p, rgb);
        if d < best.0 {
            best = (d, i);
        }
    }
    best.1
}

/// More distinct colours than this and the k-means rounds are skipped: a photograph does not need them to be
/// good enough, and they would cost more than the rest of the page.
const REFINE_AT_MOST: usize = 20_000;
const REFINE_ROUNDS: usize = 4;

/// A page's pixels with a palette of at most `colours` colours.
pub struct Indexed {
    pub palette: Vec<[u8; 3]>,
    pub pixels: Vec<u8>,
}

/// Quantise premultiplied RGBA pixels, which are taken to be opaque (a page has a white ground).
pub fn quantize(rgba: &[u8], colours: usize) -> Indexed {
    // The distinct colours, with a run of equal neighbours counted once.
    let mut counts = Counts::default();
    let mut previous = u32::MAX;
    let mut run = 0_u32;
    for p in rgba.as_chunks::<4>().0.iter() {
        let colour = pack(p[0], p[1], p[2]);
        if colour == previous {
            run += 1;
        } else {
            if run > 0 {
                *counts.entry(previous).or_insert(0) += run;
            }
            previous = colour;
            run = 1;
        }
    }
    if run > 0 {
        *counts.entry(previous).or_insert(0) += run;
    }
    let mut entries: Vec<Entry> = counts
        .iter()
        .map(|(&colour, &count)| Entry {
            rgb: unpack(colour),
            count: i64::from(count),
        })
        .collect();
    entries.sort_by_key(|e| e.rgb);

    // A palette: the colours themselves if there are few enough, else the cells of a median cut.
    let mut palette: Vec<[i32; 3]> = if entries.len() <= colours {
        entries.iter().map(|e| e.rgb).collect()
    } else {
        let mut cells = vec![Cell {
            entries: entries.clone(),
        }];
        while cells.len() < colours {
            // The cell with the most error; the first of equals.
            let Some((worst, error)) = cells
                .iter()
                .enumerate()
                .map(|(i, c)| (i, c.error()))
                .max_by_key(|&(i, error)| (error, std::cmp::Reverse(i)))
            else {
                break;
            };
            if error == 0 {
                break;
            }
            let (a, b) = cells.swap_remove(worst).split();
            cells.push(a);
            cells.push(b);
        }
        cells
            .iter()
            .map(|c| {
                let m = c.mean();
                [m[0] as i32, m[1] as i32, m[2] as i32]
            })
            .collect()
    };

    // A few rounds of k-means over the distinct colours.
    if entries.len() > colours && entries.len() <= REFINE_AT_MOST {
        for _ in 0..REFINE_ROUNDS {
            let mut sums = vec![[0_i64; 3]; palette.len()];
            let mut weights = vec![0_i64; palette.len()];
            for e in &entries {
                let i = nearest(&palette, e.rgb);
                weights[i] += e.count;
                for axis in 0..3 {
                    sums[i][axis] += e.count * i64::from(e.rgb[axis]);
                }
            }
            for (i, p) in palette.iter_mut().enumerate() {
                if weights[i] > 0 {
                    let round = |v: i64| ((v + weights[i] / 2) / weights[i]) as i32;
                    *p = [round(sums[i][0]), round(sums[i][1]), round(sums[i][2])];
                }
            }
        }
    }

    // A canonical order, so that the file does not depend on how the cells happened to be split.
    palette.sort_unstable();
    palette.dedup();

    // Each distinct colour gets its index once; the pixels then follow.
    let index: Counts = entries
        .iter()
        .map(|e| {
            (
                pack(e.rgb[0] as u8, e.rgb[1] as u8, e.rgb[2] as u8),
                nearest(&palette, e.rgb) as u32,
            )
        })
        .collect();
    let mut pixels = Vec::with_capacity(rgba.len() / 4);
    let mut previous = (u32::MAX, 0_u8);
    for p in rgba.as_chunks::<4>().0.iter() {
        let colour = pack(p[0], p[1], p[2]);
        if colour != previous.0 {
            previous = (colour, index.get(&colour).copied().unwrap_or(0) as u8);
        }
        pixels.push(previous.1);
    }
    Indexed {
        palette: palette
            .iter()
            .map(|c| [c[0] as u8, c[1] as u8, c[2] as u8])
            .collect(),
        pixels,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(colours: &[[u8; 3]]) -> Vec<u8> {
        colours
            .iter()
            .flat_map(|c| [c[0], c[1], c[2], 255])
            .collect()
    }

    fn colour_at(result: &Indexed, i: usize) -> [u8; 3] {
        result.palette[usize::from(result.pixels[i])]
    }

    #[test]
    fn few_colours_are_kept_exactly() {
        let pixels = rgba(&[
            [255, 255, 255],
            [0, 0, 0],
            [229, 3, 57],
            [255, 255, 255],
            [0, 0, 0],
        ]);
        let result = quantize(&pixels, 64);
        assert_eq!(result.palette.len(), 3);
        for (i, original) in pixels.chunks(4).enumerate() {
            assert_eq!(
                colour_at(&result, i),
                [original[0], original[1], original[2]]
            );
        }
    }

    #[test]
    fn a_long_ramp_is_cut_to_the_palette_and_stays_close() {
        // 256 greys, with a lot of white and some black: the anti-aliasing of text on a page.
        let mut colours: Vec<[u8; 3]> = (0..256).map(|g| [g as u8; 3]).collect();
        colours.extend(std::iter::repeat_n([255, 255, 255], 5000));
        let pixels = rgba(&colours);
        let result = quantize(&pixels, 16);
        assert!(result.palette.len() <= 16);
        for (i, original) in pixels.chunks(4).enumerate() {
            let got = colour_at(&result, i);
            assert!(
                got[0].abs_diff(original[0]) <= 24,
                "{original:?} -> {got:?}"
            );
        }
        // The ground stays exactly white.
        assert!(result.palette.contains(&[255, 255, 255]));
        assert_eq!(colour_at(&result, colours.len() - 1), [255, 255, 255]);
    }

    #[test]
    fn a_ground_that_a_few_near_whites_share_a_cell_with_stays_255() {
        let mut colours = vec![[255, 255, 255]; 1000];
        colours.extend([[254, 254, 254]; 3]);
        colours.extend([
            [0, 0, 0],
            [30, 30, 30],
            [60, 60, 60],
            [90, 90, 90],
            [120, 120, 120],
        ]);
        let result = quantize(&rgba(&colours), 3);
        assert_eq!(colour_at(&result, 0), [255, 255, 255]);
    }

    #[test]
    fn the_same_pixels_give_the_same_palette_and_picture_in_any_order_of_their_first_sight() {
        // Same distinct colours and counts, laid out differently: one palette.
        let a: Vec<[u8; 3]> = (0..300)
            .map(|i| [(i % 100) as u8 * 2, (i % 7) as u8 * 30, (i % 13) as u8 * 15])
            .collect();
        let mut b = a.clone();
        b.reverse();
        let (ra, rb) = (quantize(&rgba(&a), 8), quantize(&rgba(&b), 8));
        assert_eq!(ra.palette, rb.palette);
        let again = quantize(&rgba(&a), 8);
        assert_eq!(ra.pixels, again.pixels);
        assert_eq!(ra.palette, again.palette);
    }

    #[test]
    fn the_palette_is_in_a_canonical_order_without_repeats() {
        let a: Vec<[u8; 3]> = (0..200)
            .map(|i| {
                [
                    (i * 5 % 256) as u8,
                    (i * 11 % 256) as u8,
                    (i * 3 % 256) as u8,
                ]
            })
            .collect();
        let result = quantize(&rgba(&a), 10);
        assert!(result.palette.windows(2).all(|w| w[0] < w[1]));
        assert!(
            result
                .pixels
                .iter()
                .all(|&p| usize::from(p) < result.palette.len())
        );
    }

    #[test]
    fn an_empty_image_has_an_empty_palette() {
        let result = quantize(&[], 64);
        assert!(result.palette.is_empty() && result.pixels.is_empty());
    }
}
