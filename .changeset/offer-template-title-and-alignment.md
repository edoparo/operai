---
'@operai/crm-api': minor
'@operai/crm-ui': minor
---

Offer templates can now set the wording of the document title and centre or right-align paragraphs. In the template editor, "Document title" has a field for Italian and one for English; what you write replaces "CONTRATTO DI FORNITURA" / "SUPPLY CONTRACT" before the reference on page 1 (for example "OFFERTA" or "OFFER"), the reference is still added for you, and an empty field keeps the usual title. Offers already issued keep the title they were generated with. In the template text, a paragraph written as `->text<-` is centred and one written as `->text->` is right-aligned; a backslash before the opening marker (`\->`) prints it as written. Both apply to the layout service's pages and to the PDF crm-api draws itself.
