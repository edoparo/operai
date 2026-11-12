---
"@operai/meetings-api": patch
---

Long recordings no longer fail to transcribe: each 30-minute part is now streamed from Gemini on Vertex AI (`streamGenerateContent`), so a reply that takes more than five minutes is no longer lost on the way back, and at most two parts run at once, which keeps Vertex's shared capacity from refusing them with 429. Every request now logs one content-free line (part, outcome, HTTP status, finish reason, duration, bytes), so the cause of a failed transcription is visible.
