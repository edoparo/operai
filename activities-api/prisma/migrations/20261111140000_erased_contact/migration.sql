-- specs/028 AC-8.4 under concurrency (OWASP review M1, ADR-0082). The foreign key that used to
-- null `activity.contactId` when crm-api deleted a contact is gone (the contact lives in another
-- service), and a sweep before the delete cannot stop a write that validated while the contact
-- still existed from committing the link afterwards. An erased contact leaves a tombstone: its
-- id and nothing else, no personal data, so the table can stay forever. A write that sets a
-- contactId takes the same advisory lock as the erasure (`contact:<id>`) and refuses an erased id.
CREATE TABLE "erased_contact" (
    "contactId" TEXT NOT NULL,

    CONSTRAINT "erased_contact_pkey" PRIMARY KEY ("contactId")
);
