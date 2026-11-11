---
"@operai/ui": patch
"@operai/shell": patch
---

The recorder widget no longer slides and resizes when it appears: `FloatingPanel` glides only when the person moves it (arrow keys or a drop), and a change of size is applied at once; the shell shows its loading fallback only when the widget takes longer than 400 ms to load.
