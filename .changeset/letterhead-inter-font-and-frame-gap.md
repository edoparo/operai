---
'@operai/letterhead-api': minor
'@operai/letterheads-ui': minor
---

Letterheads can now be set in Inter, and the distance between the header or footer and the body is adjustable. Inter (regular, bold and italic) joins the font list for the body text, the headings and the header and footer. Each header and footer has a new "Distance from the body (mm)" field, between 0 and 40 mm, 3 mm by default: increase it to move the logo and header text further from the body. A distance that no longer fits the margin together with the header or footer is refused on save as before ("does not fit the top margin"), and a version saved earlier opens with 3 mm and prints exactly as it did.
