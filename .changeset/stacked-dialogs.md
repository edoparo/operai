---
"@operai/ui": patch
"@operai/estimai-ui": patch
---

A confirmation opened on top of another dialog now closes on its own: Escape
and Tab act on the topmost dialog only, so cancelling "Remove this
collaborator?" no longer closes the collaborators dialog too. EstimAI's
collaborators dialog now uses the shared dialog frame.
