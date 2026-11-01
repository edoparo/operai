---
"@operai/ui": minor
"@operai/shell": minor
"@operai/estimai-ui": minor
"@operai/refund-ui": patch
"@operai/admin-ui": minor
"@operai/notify-ui": minor
"@operai/inventory-ui": minor
---

Every tool now shares one look for actions, text and page layout: buttons and
dialogs come from the shared library with the same meaning-based styles
(primary actions meet contrast everywhere, cancel is quiet, destructive is
red), text uses one type scale with an 11px minimum, labels drop their "+"
and arrow prefixes, each tool has the same title bar, tabs and page header on
a common width scale, and every detail page has a "Back to …" link. EstimAI's
shortcuts, health and About dialogs are now real modal dialogs.
