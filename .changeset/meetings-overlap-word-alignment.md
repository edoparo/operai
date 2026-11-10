---
"@operai/meetings-api": patch
---

Where two parts of a long recording overlap, the same speech no longer appears twice under two speaker names when the two parts heard a few words differently: the overlap is aligned word by word (near-equal and differently heard words pair up when their times are close) instead of needing 8 identical words in a row. Speech found in only one part is still kept.
