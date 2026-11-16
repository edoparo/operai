---
'@operai/crm-ui': patch
---

The company, contact and deal dialogs now move focus to the field the server refused (scrolled into view, marked invalid and described by the message), or to the announced error banner when the refusal names no field, on create and on edit. Before, focus stayed on `<body>` and a refused field in a tall dialog was out of sight.
