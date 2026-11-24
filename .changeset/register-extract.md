---
"@operai/refund-api": minor
"@operai/refund-ui": minor
---

The accounting export card of a batch offers a second Excel file, the register extract: the same WellD CH lines laid out like the accountant's register (Worker, Period, No., Description, From, To, Reason, Date, Km / Monthly avg rate, Multiplier / Foreign Amount, Total, Account, Description, IVA, IVA2, Approved by), one sheet named after the year, ready to paste under the register's rows. It is built from the same lines, under the same blockers and rate copies as the journal, and every download is logged with its kind (`journal` or `register`; migration `20261124150000_register_extract`).
