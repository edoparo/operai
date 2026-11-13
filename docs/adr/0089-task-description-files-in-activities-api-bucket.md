# 0089 — A task's description is rich text whose pictures and attachments live in activities-api's own EU bucket, named by id and never by URL, and deleted before the rows that lead to them

**Date:** 2026-11-13  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner): "I task non hanno la descrizione … che deve supportare anche le immagini e gli allegati"; chose activities-api's own bucket, images inline plus a list of attachments, tasks only, built directly on `main`  
**Project:** Operai

---

## Context

Tasks in the CRM and in Projects live in activities-api (specs/028, ADR-0081). A task had only a subject. The CRM's form also offered a plain "Details" text, and Projects offered nothing (specs/028 AC-3.6). People need to describe the work, show a screenshot, and attach the offer or the requirements. activities-api had no object storage (AGENTS.md said so). The suite already has the pattern for files: refund, inventory, crm and meetings each own a private EU bucket, uploads go straight from the browser through a presigned POST, and reads use a short presigned GET minted after an authorization check (ADR-0016). The rich-text editor already exists in `@operai/ui/rich-text` (Meetings notes).

## Decision

1. **Description.** A task has one text: `activity.description`, a TipTap/ProseMirror document stored as JSONB.
   - Constraints, enforced by CHECKs: tasks only, `type: "doc"`, at most 128 KiB, no NUL, bounded depth.
   - Plain text sent as `body` is kept as paragraphs. This covers an older client and crm-api's estimate task.
   - The migration converts every existing task body the same way and clears it.
   - Other activity types keep their plain `body`.
2. **Files.** Files are rows of `activity_file`: kind `image` or `attachment`, status `pending` or `stored`.
   - Each file is one object `activities/<activityId>/<fileId>` in activities-api's **own** bucket `activities` (Railway, `ams`, declared in `.railway/railway.ts`), never another tool's.
   - Upload has two phases: a presigned POST with type and size pinned in the policy, then a confirm by the uploader that HEADs the object.
   - Policy:
     - images: PNG, JPEG, GIF, WebP, ≤ 10 MiB, never SVG;
     - attachments: PDF, Office, text, CSV or images, ≤ 20 MiB;
     - at most 20 files per task.
   - Reads are a 60 s presigned GET: `inline` for an image, `attachment` for an attachment.
3. **Images by id.** An image in the text is a node with `attrs.fileId`, never a URL.
   - The server accepts a description only if every image id is one of **this task's stored images**. Anything else is 422 `image_not_found`.
   - The UI renders documents as React elements (`RichTextView`), never as HTML, and resolves each id through the API.
   - HTML pasted from elsewhere does not become an image.
4. **Access is the task's**, asked of the host as the caller (ADR-0081).
   - Whoever may read the task sees and downloads its files.
   - Whoever may edit it (`mayChange` + `writable`) adds, confirms and removes them.
   - A file of another task, or a pending one, is the 404 of a missing file.
   - Only the uploader confirms an upload.
5. **Deletion order: the object, then the row** (ADR-0063).
   - Deleting a task, through the user route or crm-api's compensation, deletes every object first. Any bucket failure is a 503 and nothing is deleted.
   - A file added in between makes the delete a 409 rather than orphan an object.
   - The FK is `RESTRICT`, so a task is never deleted with rows still pointing at the bucket.
6. **Clean-up after a save, never by a sweep** (ADR-0013).
   - When a description is saved, three kinds of file are removed, each object before its row and best effort:
     - images the previous description showed and this one does not;
     - images never shown for 24 h;
     - uploads still pending after 1 h.
   - An image uploaded a moment ago and not yet placed is kept, because another editor may be about to save it.
   - An image the description still shows cannot be deleted directly (409 `image_in_use`).
7. **Forms save files on submit.**
   - Pictures and attachments chosen in a form stay in the browser (`useDeferredFiles`, `blob:` previews) until the task is saved, so cancelling uploads nothing.
   - The task is saved first, without pictures that have no id yet, so a refused field touches no file.
   - Then the files are uploaded and removed (`commitDeferredFiles`), and finally the description is saved again with the stored ids.
   - A file that fails is named to the person, and the task stays saved.
8. **Library.** `@operai/ui` gains `AttachmentList`. Its `rich-text` entry gains five things:
   - images in `RichTextEditor` (the `images` prop: button, paste, drop);
   - `RichTextView` and `RichTextFilesView`;
   - `RichTextFilesField`;
   - `useDeferredFiles` and `commitDeferredFiles`;
   - the doc helpers.
   
   crm-ui and projects-ui install TipTap and alias the entry, as meetings-ui does.

This amends specs/028 AC-3.6: the project task dialog now has a description.

## Failure shape

**A document that can name a resource by address makes every reader's browser fetch whatever the author wrote, and a delete that removes the record before its stored bytes leaves bytes nobody can reach or delete.**

- **URL in content.** An `<img src>` (or link) stored in user content is a request every reader makes: tracking, a forged-request target, content the record's access never checked. Name the resource by an id the service resolves for the reader, after its own access check.
- **Row first, object later.** If the database delete commits and the bucket delete fails, the object has no row, no key anyone knows, and no retention rule. Delete the object first; a failure must leave the row so the next attempt can find it.
- **Upload before the record exists.** Uploading files from a form that may be cancelled leaves objects for records that never were. Keep them in the browser until the record is saved.
- **A sweep that decides "unused".** A periodic job deleting files it thinks unreferenced races every editor holding one not yet saved. Decide on the write that stops referencing the file, with a grace period for files never referenced yet.

## Options considered

1. **Own bucket in activities-api (chosen).** This is the suite's pattern (ADR-0016) and keeps access with the task (ADR-0081).
2. **Each host's bucket (crm-api's for CRM tasks, a new one for Projects).** Rejected. It splits one feature over two services and two code paths, and activities-api would need to call a host to read a task's files.
3. **Images as data URLs inside the JSON.** Rejected. Megabytes in every list read, no size control per file, and the 128 KiB document limit could not hold them.
4. **Upload immediately while editing.** Rejected. Cancel would leave objects behind, and a create would need a record id before the record exists.
5. **A nightly orphan sweep.** Rejected (ADR-0013). Clean-up runs on the save that stops referencing a file.

## Consequences

- activities-api now has object storage: a fourth bucket. `ACTIVITIES_S3_*` are optional (file routes answer 503 `storage_unconfigured` without them) and the residency check runs at startup like the others (`s3Residency.ts` is a registered shared copy).
- Production needs, once:
  - `railway config apply` to create the bucket;
  - the four bucket variables on activities-api, by reference;
  - a CORS rule on the bucket for `https://operai.welld.io` (POST, GET);
  - the shell's CSP allowing `img-src https://t3.storageapi.dev blob:` (done in `shell/vercel.json`).
- Request bodies of `POST /activities` and `PATCH /activities/{id}` may be up to 192 KiB; every other route keeps 64 KiB.
- Images are not listed as attachments. An image removed from the text disappears on the next save.

## Compliance notes

- Data residency: the bucket is EU (`ams`), its endpoint must match `ACTIVITIES_S3_EU_ENDPOINT_HOSTS` or the service does not start; bytes never pass through activities-api (presigned POST and GET only).
- No file name or content is logged; clean-up failures log the file id and the error name only.
