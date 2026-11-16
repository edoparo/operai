---
'@operai/meetings-api': patch
---

Test-only: two flaky tests are made deterministic, with no change to the service. The long-recording transcription test now answers each request with the reply of the part it carries instead of the next reply in line (the parts run concurrently, so the order of the requests is not fixed), and the real-ffmpeg byte-cap test builds a smaller input that still exceeds the cap and no longer fails on a loaded machine.
