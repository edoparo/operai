---
"@operai/meetings-api": patch
---

Long recordings no longer split the same person into a new speaker label at every part: a label is joined to the previous part's when at least 80 % of the words both parts transcribed agree in both directions (it needed 100 %), and a silence where the parts overlap no longer prevents it. Refusals are logged by cause.
