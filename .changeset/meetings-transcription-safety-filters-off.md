---
'@operai/meetings-api': patch
---

A recording is no longer refused by the transcription model's content filters. A long meeting could fail every time on the same half hour because Gemini's default harm filters blocked part of the transcript (a word, a joke or a sensitive topic), and one blocked part failed the whole meeting. The transcription request now turns the configurable filters off: a transcript records what was said. A meeting that failed this way can be retried from its page.
