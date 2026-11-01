---
"@operai/ui": minor
"@operai/admin-ui": patch
"@operai/inventory-ui": patch
"@operai/estimai-ui": patch
"@operai/shell": patch
---

The design system gains `Combobox` (suggestions while typing) and `Drawer` (a
side panel for reference content). Admin's address and country fields and
Inventory's holder and supplier pickers now share the one `Combobox`, which
also keeps the highlighted suggestion in view in a long list. EstimAI's model
reference opens in the library `Drawer`. Admin's user detail and mileage-rate
pages read permissions from the shell instead of fetching them again. The
suite's end-to-end tests look for the current Refund label instead of the old
"Refund (Rimborsi)".
