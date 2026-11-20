---
'@operai/meetings-api': minor
---

A long recording is no longer lost because the transcription model refuses one half hour of it. When the model refuses a part for its content (a safety, prohibited-content, blocklist, personal-data or recitation filter, or a blocked request), the other parts are kept and the refused stretch is shown as a possible gap: the transcript says "Speech may be missing between …", with markers in the text and the same caveat on summaries and answers as any other gap. The meeting still fails when every part is refused, or when a part fails for any other reason.
