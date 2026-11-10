---
"@operai/meetings-api": minor
---

Meetings are transcribed by Gemini on Vertex AI (EU): a meeting up to 30 minutes goes in one request, so the same person keeps one speaker label for the whole meeting instead of a new one every 10 minutes. The reply is accepted only in the expected structure, request logging for the model is checked off at startup, and Chirp 3 stays available with `MEETINGS_TRANSCRIBER=chirp`.
