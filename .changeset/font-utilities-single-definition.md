---
"@operai/ui": patch
---

The font utilities `font-disp` and `font-body` are now defined once, by
Tailwind from the theme tokens; the hand-written duplicates, which overrode
every utility and fell back to `fantasy`/`serif`, are removed.
