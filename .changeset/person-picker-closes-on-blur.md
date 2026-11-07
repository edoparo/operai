---
"@operai/ui": patch
"@operai/meetings-ui": patch
"@operai/crm-ui": patch
---

The person picker's list closes when focus leaves the field, instead of staying open over the fields below it (only Escape, Tab or a choice closed it). A click inside the open list, on its scrollbar or its empty line, no longer counts as leaving the field.
