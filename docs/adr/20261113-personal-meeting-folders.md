# 20261113 — A way of organising shared records is the organiser's own: personal meeting folders, one level, one folder per meeting and person

**Date:** 2026-11-13  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner): "Sarebbe molto comodo poter organizzare i meeting in 'cartelle'". He chose personal folders, one folder per meeting, a single level, built directly on `main`.  
**Project:** Operai

---

## Context

The Meetings list grows with every meeting a person creates or joins. It can be searched and filtered by role, status and linked app, but it cannot be grouped the way the person thinks of their work (by client, by project, by quarter).

Meetings are visible by relationship to the record, never by role (ADR 20261104-meetings-tool-shape-visibility-by-participation): the creator, the Operai participants and opted-in host readers. Any grouping that more than one person can see would show the meetings in it, or at least their titles, to people outside that relationship, or it would need visibility rules of its own.

## Decision

1. **Folders are personal.**
   - A folder belongs to one person (`meeting_folder.ownerUserId`).
   - No other person, role (admin, `meeting:erase`) or service reads it.
   - Two participants of the same meeting file it independently.
   - Folder names never reach a model, a host or a log. The log-privacy canary test covers them.
2. **One level, at most one folder per meeting and person.**
   - `meeting_folder_entry` has the primary key `(meetingId, userId)`, so moving a meeting replaces its entry.
   - A composite foreign key `(folderId, userId) → meeting_folder(id, ownerUserId)` makes it impossible to file a meeting in someone else's folder, even by a bug.
   - A name is 1–80 characters, trimmed, without control characters, and unique per owner ignoring case (CHECK and unique index on `lower(name)`).
   - A person may keep at most 200 folders (422 `folder_limit`).
3. **Access.** All routes are JWT only (`selfScoped`), like personal notes: organising your own view changes no meeting's record, so it needs no grant and keeps working while `auth` is down.
   - `GET/POST /folders`, `PATCH/DELETE /folders/{id}`: a folder of someone else is the 404 of a missing one.
   - `PUT /meetings/{id}/folder` (`{ folderId | null }`): needs only that the caller can open the meeting (the identical 404 otherwise). A folder id that is not the caller's is 422 `folder_not_found`.
4. **The list.**
   - `GET /meetings?folder=<id>|none` narrows "My meetings", and each row carries the caller's own `folderId`.
   - A folder's count includes only the meetings the person can still open. A removed participant's entry stays but matches nothing.
5. **Deletion.**
   - Deleting a folder deletes only its entries; the meetings stay, in no folder.
   - Deleting a meeting deletes every person's entry for it (`ON DELETE CASCADE`).
   - There is no sweep: the entries die with the rows they point at.
6. **UI** (meetings-ui list, both `./App` and `./MyMeetings`):
   - a "Folder" filter;
   - a folder select on each row;
   - "New folder", and, when a folder is selected, "Rename folder" and "Delete folder" (`FormDialog`/`ConfirmDialog`).

   When the folders cannot be loaded, every folder control is hidden and the list works as before.

## Failure shape

**A grouping of shared records, once shared, becomes a second access path to them.** A shared folder lists titles to everyone who can see the folder. The visibility rule then has to be decided twice, and the two answers drift. Keep the organiser's arrangement private to the organiser, and let the record's own rule decide who sees the record.

## Options considered

1. **Personal folders (chosen).** They touch no visibility rule, and each person gets the arrangement they want.
2. **Folders set by the creator, seen by every participant.** Rejected. The creator's arrangement is imposed on everyone, and a participant would see folder names describing meetings they are not in.
3. **Team-wide folders.** Rejected. This needs new visibility rules for meetings inside a folder (ADR 20261104-meetings-tool-shape-visibility-by-participation says relationship, never role).
4. **Tags (several per meeting).** Rejected for now: the owner asked for folders. The entry table could gain a second row per person if this changes.
5. **Nested folders.** Rejected for now. A tree adds moves, cycles and recursive deletes for little gain at today's volume. A `parentId` can be added without breaking the shape.

## Consequences

- meetings-api gains two tables, five routes (all in the authorization matrix and the outage pin) and a `folder` list parameter. No environment variable and no new service.
- Folder edits have no If-Match: a folder is one person's, and a lost rename between two of their own tabs is harmless.
- Revisit this ADR for shared folders, tags or nesting.
