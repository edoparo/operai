---
"@operai/meetings-api": patch
"@operai/notify-api": patch
---

Tests only: the env-group test no longer picks up a local dotenv file, and the ogg probe fixture uses ffmpeg's built-in Vorbis encoder instead of the optional libvorbis.
