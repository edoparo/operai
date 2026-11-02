# Decisions — specs/019 CRM notifications

**D-1 — notify-api resolves the address (owner, 2026-11-01).** The caller names a user by
id and asks for an email notice. notify-api asks auth for the address when it sends.
- Callers never handle addresses, and every later tool gets email notices without code of
  its own.
- Rejected: crm-api looking addresses up itself. It would need a lookup that a technician
  could not trigger (the directory is gated by `deal:manage`, ADR-0053), and every tool would
  repeat it. Recorded in ADR-0056.

**D-2 — One user per lookup, not a batch.** notify-api handles one notification per request,
so a batch endpoint would always be called with one id. One id per call also keeps the
endpoint useless for harvesting the user list in bulk.

**D-3 — An email notice needs `emails.send` as well as `notifications.push`.** Sending an
email is a capability of its own (ADR-0049: one scope per capability). A push-only client,
such as inventory-api today, cannot start sending emails just by adding `email: true`.

**D-4 — A generic `notification_notice` template, built from the notification itself.**
- The email repeats what the in-app notification says, with a link back into Operai. It
  needs no per-event fields, so one fixed, escaped template serves every tool.
- It cannot be called through `/system/emails`, because there the caller supplies the
  address.

**D-5 — English only (owner, O2).** Email notices are English, like the refund emails. The
in-app copy is English too; only the origin label is translated, as for the other tools.

**D-6 — E5 also sends an email (owner, O3).**

**D-7 — Optional env groups in crm-api and notify-api.** Without them crm-api sends nothing
and notify-api skips email notices. Local development and the existing tests keep working,
as with `ESTIMAI_API_URL` in 018 (D-15). They become required in the production templates
once provisioned (T11).

**D-8 — "A new owner" includes creation.** When someone creates a deal and makes a colleague
its owner, that colleague is notified. Creating a deal for yourself notifies nobody.
