---
id: 20261124
slug: receipt-numbers-from-the-register
status: done
rigor: production
created: 2026-11-24
approved: 2026-11-24
done: 2026-11-24
---

# Receipt numbers from the accountant's register: one number per receipt, and a receipt code per employee

## Problem

Refund 0.4.0 is in production and refuses every approval (409 `accounting_release_pending`) until
the accounting release has run. The release, as 20261118 AC-7.1 specifies it, gives every expense
approved before it a new receipt number after the employee's last paper number. But the accountant
has already numbered by hand, in the paper register `Recap_RS_2026`, almost every one of those
expenses: on production, of 88 WellD CH lines approved or paid before the release, 77 match a register
row exactly (employee, expense date, amount), 8 match the date with another amount and 3 match nothing.
Run as specified, the release would put two numbers on one receipt (for example paper `AB26/001-020`,
then Operai `AB26/021-040`) and the books would carry each of those expenses twice under different
numbers. Separately, the receipt number is built from two initials, and two pairs of employees share
initials (two "LC", two "FR"); the register already keeps separate sequences for them under the same
two letters, so a number does not say whose receipt it is. Accounting asks for three-letter codes in
these cases. The release must not run until both are settled, and approvals stay blocked meanwhile.

## Domain language

Extends specs/20261118-refund-accounting-export (receipt number, last hand-issued number, release),
specs/20261119-accounting and specs/20260716-refund-service. New terms:

- **pre-release line** — a WellD CH expense line, not rejected, of a request approved or paid before
  the release and not yet numbered (the lines AC-7.1 of 20261118 numbers). WellD Italia lines are not
  pre-release lines (20261118 AC-7.3).
- **register export** — a file, supplied by the operator and kept outside the repository, exported
  from the accountant's register: one row per register entry with at least the worker, the number,
  the expense date and the total. It is read at the release and never stored.
- **register row** — one row of the register export. **Paper number** — the number written in its
  "No." column, shaped `<letters><yy>/<seq>` (for example `AB26/005`). A row with an empty "No." has
  no paper number.
- **candidate** — a register row of the same employee and the same expense date as a line.
- **exact match** — a line with exactly one candidate that has a paper number and whose total equals
  the line's approved total to the cent, such that the same row is not an exact candidate of another
  line.
- **doubtful** — a pairing that is not an exact match and that a person must decide (AC-1.3 to
  AC-1.5, AC-1.8, AC-1.10 to AC-1.13).
- **pairing file** — the file that says, for each pre-release line, which paper number it takes or
  that it takes a new number, and whether a person has confirmed it. The dry run proposes it; the real
  run reads the confirmed file. Kept outside the repository.
- **imported number** — a paper number written on a line by the release.
- **receipt code** — two or three letters A-Z, set for one employee by accounting, used as the
  prefix of the employee's new receipt numbers instead of the initials derived from the name.
- **prefix** — the letters before the year digits of a receipt number (`AB`, `ABX`).

## User stories

### US-1: Accounting gets every pre-release receipt with exactly one number, the paper one where it exists

As an accounting user, I want each expense approved before the release to carry the number I wrote
in the register when there is one, and a new number only when there is none, so that no receipt is
in the books under two numbers.

**Acceptance criteria:**
- AC-1.1: Given a pre-release line of employee A dated 2026-03-12 with an approved total of 24.50 and
  exactly one register row of employee A dated 2026-03-12 with total 24.50 and number `AB26/005`, when
  the dry run proposes the pairing, then the line is listed as an exact match with `AB26/005`; and
  when the release runs on a pairing file that confirms it, then the line's receipt number is
  `AB26/005`.
- AC-1.2: Given a completed release, then every pre-release line has exactly one receipt number: a
  line that took a paper number received no other number, and no number was issued that no line holds.
- AC-1.3 (same date, different amount): Given a line and a candidate whose total differs from the
  line's approved total, and no exact match for the line, when the dry run proposes, then the line is
  listed as doubtful with the reason "amount differs", showing both amounts and the paper number, and
  is not taken by default. The real run takes that paper number only if the pairing file confirms it
  for that line.
- AC-1.4 (several candidates): Given a line with two or more candidates that could be its exact
  match, or a register row that is the exact candidate of two or more lines, when the dry run proposes,
  then each line involved is listed as doubtful with the reason "several candidates" and the paper
  numbers concerned, and none is taken by default.
- AC-1.5 (paper number already taken): Given a paper number proposed or confirmed for two lines of
  the same employee that are not declared a split receipt (AC-1.6), when the dry run runs, then both
  lines are listed as doubtful with the reason "number already taken"; and when the real run reads a
  pairing file that gives one number to two such lines, then the run is refused and nothing is written.
- AC-1.6 (split receipt, two lines, one number): Given two pre-release lines of employee A with the
  same expense date, each with an exact candidate row, and the two rows carry the same paper number
  (for example `FR26/002` on two rows, one receipt entered with two VAT codes), when the dry run
  proposes, then the two lines are listed as a split receipt with that number, to be confirmed; and
  when the pairing file confirms the split, then both lines take that number. This is the only case in
  which two receipt numbers of the same employee and year are equal: the pairing file must name both
  lines as one split receipt, the lines must belong to the same employee and the same expense date, and
  the number must be a paper number. A new number is never shared.
- AC-1.7 (split receipt, one line, two rows): Given one pre-release line and two candidate rows with
  the same paper number whose totals add up to the line's approved total, when the dry run proposes,
  then the line is listed as a split receipt to be confirmed, and when confirmed the line takes that
  number once. Given one line and two candidate rows with different paper numbers, then the line is
  doubtful (AC-1.4); when the person picks one number, the other stays in the register only and still
  counts toward the maximum (AC-3.1).
- AC-1.8 (unmatched line): Given a pre-release line with no candidate, when the dry run proposes, then
  it is listed as "no paper counterpart" and proposed as a new number; the real run gives it a new
  number (AC-3.2) only if the pairing file confirms "new" for that line.
- AC-1.9 (register row with no line): Given a register row of an employee that no pre-release line
  pairs with, then nothing is written for it; it only feeds the employee's maximum (AC-3.1), and the
  report counts such rows.
- AC-1.10 (wrong-year number): Given a line whose candidate row carries a number whose year digits are
  not those of the expense year (for example `LG25/003` on an expense of 2026), when the dry run
  proposes, then the line is doubtful with the reason "wrong year", and is never taken by default. The
  pairing file confirms either that number as written, or a new number. A wrong-year number counts
  toward the employee's 2026 maximum under the rule of AC-3.1.
- AC-1.11 (number `..26/000`): Given a candidate row with the sequence `000`, when the dry run
  proposes, then the line is listed in its own list "sequence 000", never taken by default. Unless
  the pairing file confirms that number as written, the line takes a new number. A `000` never counts
  toward a maximum.
- AC-1.12 (prefix differs): Given a paper number whose prefix is neither the employee's receipt code,
  nor the initials Refund would derive for the employee, nor the prefix of the employee's other
  confirmed or exact paper numbers, when the dry run proposes, then the line is doubtful with the reason
  "prefix differs". A paper number whose prefix is simply not the employee's receipt code, but is that
  of the employee's other paper numbers, is not doubtful (paper numbers predate the code, AC-4.4).
- AC-1.13 (rows with no number, no date or malformed): Given a register row with an empty number (for
  example a monthly statement row not yet renumbered), then it is treated as having no paper number: it
  is never proposed as a number to take, and it counts toward no maximum. A pre-release line whose only
  candidate is such a row is listed as doubtful with the reason "matches a row without a number",
  proposed as a new number (AC-3.2) and taken as new only if the pairing file confirms "new" for it; the
  report counts these rows. Given a row with a number but no readable date or total, then it is not
  matched automatically, is listed, and its number counts toward the maximum; a person may pair it by
  hand in the pairing file. Given a number not of the shape `<letters><yy>/<seq>`, then it is listed by
  row with the shape of the cell only, and counts toward nothing; the real run refuses while a malformed
  number is not acknowledged in the pairing file.
- AC-1.14 (employees): Given register workers, then the dry run maps each worker to an Operai employee
  and lists the workers it cannot map or maps to more than one; the pairing file records the mapping
  confirmed by a person, and a worker may be marked "not an Operai employee". The real run is refused
  while a worker is unmapped and unmarked. A mapping is by employee, never by prefix: two employees with the same
  prefix keep separate rows and separate sequences.
- AC-1.15 (test account): Given an employee marked in the pairing file as "excluded from the register"
  (the owner's test account), then no register row is paired to it and none counts toward its baseline;
  its pre-release lines take new numbers by US-3 from `001`, with the receipt code it holds (AC-4.11
  applies to it like to any employee).
- AC-1.16 (lines outside 2026): Given a pre-release line whose expense date is not in 2026, then it is
  proposed as "no paper counterpart" and, once confirmed, numbered in the sequence of its own expense
  year from `001` (20261118 AC-4.5, AC-4.12).
- AC-1.17 (audit): Given a line numbered by the release, then the audit trail records the number, the
  employee, that the actor is the system, the cause "release", and the origin: "paper" (with the
  register row's position in the export, never its content), "paper, split" or "new". No other
  register content is stored anywhere.
- AC-1.18: Given a completed release, then within one employee and one year no two receipt numbers
  are equal, except the lines of a confirmed split receipt (AC-1.6, AC-1.7), and no receipt number
  ever changes afterwards (20261118 AC-4.7).

### US-2: The release proposes the pairing, and nothing is written until a person confirms it

As the owner running the release, I want to see the proposed pairing before anything is written and
to confirm the doubtful cases myself, so that no receipt gets a wrong or a second number.

**Acceptance criteria:**
- AC-2.1: Given `accounting:release --dry-run` with a register export, when it runs, then it reads
  Accounting first as before (20261119 AC-7.4), writes nothing to any database (including no audit
  row and no marker), prints the report of AC-2.2 and writes the proposed pairing file to a path the
  operator gives.
- AC-2.2: Given the dry run, then its report states, per category, how many lines and register rows:
  exact matches, doubtful by reason, split receipts, no paper counterpart, register rows with no line,
  rows without a number, rows with a number but no date or total, malformed numbers, unmapped workers;
  the employees that need a receipt code (AC-4.11); for each employee, by reference (AC-5.6), the
  highest sequence and the first new number the run would issue; and for every doubtful line, its line
  identifier, expense date, amount and currency and the reason.
- AC-2.3: Given the proposed pairing file, then it lists every pre-release line with its identifier,
  employee reference, expense date, approved total and currency, category, proposed paper number or
  "new", and a state: exact matches pre-filled as proposed; doubtful ones unresolved until a person
  decides; and it records the employee mapping (AC-1.14) and a fingerprint of the register export it
  was built from.
- AC-2.4: Given a pairing file, when a person decides a line, then the decision is one of: a paper
  number that exists in the register export, "new", or membership of a declared split receipt. The
  person may also change a proposed exact match; the real run's report lists every decision that differs
  from the proposal.
- AC-2.5: Given the real run, then it takes the confirmed pairing file and the same register export as
  the dry run, and issues the numbers of AC-1 and AC-3 in one transaction.
- AC-2.6: Given a pairing file in which a pre-release line is missing, a line is unresolved, a line is
  listed that is not a pre-release line, a paper number is not in the register export, a number is
  given to two lines outside a split (AC-1.5), or a malformed number is unacknowledged, when the real
  run reads it, then the run is refused, names the problems by line identifier, and writes nothing.
- AC-2.7: Given a register export different from the one the pairing file was built from (its
  fingerprint differs), or pre-release lines that are not those of the file, when the real run starts,
  then it is refused as stale and writes nothing; running the dry run again gives a new proposal.
- AC-2.8: Given a real run with no register export or no pairing file, then it is refused with its own
  exit status and writes nothing, and the message says to run the dry run first. Lines are never
  numbered from the offsets list alone.
- AC-2.9: Given the dry run run again with the confirmed pairing file, then it reports exactly the
  numbers each line would receive and writes nothing.

### US-3: New numbers continue the employee's own sequence after the paper numbers

As an accounting user, I want the numbers Refund issues from now on to continue each employee's
sequence after the highest of everything already issued, so that no new number repeats a paper one.

**Acceptance criteria:**
- AC-3.1: Given an employee, then the 2026 baseline is the highest of: the employee's row in the
  `--offsets` list if any; the highest 2026 sequence among the register rows mapped to that employee,
  paired or not; and the highest sequence among the numbers imported for that employee. A wrong-year number
  counts when its row's expense date is in 2026, or is missing or unreadable, and does not count when
  that date is readable and outside 2026 (as `receipt-baseline:from-register` does today); a sequence
  `000`, a row without a number and a malformed number count for nothing. The report lists each employee
  where the offsets row and the register maximum differ.
- AC-3.2: Given an employee with baseline N, when the release numbers a line of that employee that
  has no paper number, then it receives N + 1 with the employee's prefix (AC-4.4), and the following
  lines continue by one with no gaps after N: for example paper `AB26/001-040` with `AB26/021` and
  `AB26/022` not matched to any line still gives the next new number `AB26/041`.
- AC-3.3: Given several lines that take new numbers for one employee, then they are numbered in order of
  expense date, then creation time, then identifier (20261118 AC-4.4).
- AC-3.4: Given an employee with register rows but no pre-release line, then the baseline is set from the
  rows, so the employee's first number issued later continues after them; given an employee with
  pre-release lines but no register row, then numbering starts at `001` (20261118 AC-4.12) and the
  report lists the employee so that a wrong mapping is noticed.
- AC-3.5: Given an employee in 2027, then the sequence restarts from `001` (20261118 AC-4.13).
- AC-3.6: Given the paper numbers below an employee's maximum that no line took, then they are left
  unused and are never given to a line.

### US-4: Accounting sets a receipt code for an employee

As an accounting manager, I want to give an employee a two or three letter code, so that two employees
with the same initials no longer share a prefix, and a number says whose receipt it is.

**Acceptance criteria:**
- AC-4.1: Given a person who holds the receipt-code capability, when they set a code for an employee
  known to Refund (one with at least one request), then the code is saved with the employee, and
  numbers issued afterwards use it.
- AC-4.2: Given a code to set, when it is not two or three letters A-Z after trimming and conversion
  of lower case to capitals (for example `A`, `ABCD`, `A1`, `ÀB`, `A B`), then it is refused naming
  the reason, and nothing is saved or audited. An empty value clears the code (AC-4.6).
- AC-4.3: Given a code to set, when another employee holds the same code, or another employee has a
  number issued or imported in Operai with that prefix in any year, then it is refused with a message
  that the code is in use, without naming the other employee, and nothing is saved or audited. Given
  two people setting the same code for two employees at the same moment, then exactly one succeeds.
- AC-4.4: Given an employee whose last issued number is `LC26/039` and who then gets the code `LCX`,
  when the next line is numbered, then it receives `LCX26/040`; the numbers already issued, paper or
  imported or issued by Refund, stay `LC26/039` and before, wherever they are shown. An employee with no
  code uses the initials of 20261118 AC-4.8. The format of a receipt number is now `<2 or 3
  letters><yy>/<seq>`.
- AC-4.5: Given an employee with a code, then it applies to every year: in 2027 the first number is
  `LCX27/001`.
- AC-4.6: Given an employee with a code, when accounting changes or clears it, then numbers issued
  afterwards use the new prefix (or the initials again) and continue the same sequence, and numbers
  already issued do not change.
- AC-4.7: Given a code set, changed or cleared, then the audit trail records who, when, the employee
  and the value before and after.
- AC-4.8: Given a number, then the batch PDF, the journal workbook (the Description of 20261118
  AC-6.13, for example `Cancelleria [LCX26/040] <name>`) and every screen show it exactly as issued,
  with the employee's name beside it where numbers are listed.
- AC-4.9: Given a person without the capability, when they try to read, set, change or clear a code,
  then it is denied and nothing changes; and at the release the accounting role and the admin role hold
  the capability and no other role does until an administrator grants it.
- AC-4.10: Given a code set at the same moment as a line of that employee is numbered, then the number
  has either the old or the new prefix, never a mixture, and the sequence has no gap and no repeat.
- AC-4.11 (shared prefix, release): Given two employees whose prefix is the same in 2026 (for example
  both derive `FR`, or both hold imported or register-mapped numbers `FR26/...`), when the dry run
  runs, then it lists every such employee that holds no receipt code; and when the real run would
  issue a new number to one of them without a code, then it is refused and writes nothing. An employee
  of such a pair whose lines all take paper numbers is not blocked.
- AC-4.12 (release): Given the codes in force when the release runs, then each new number it issues
  carries the employee's code, and the dry run shows it; a paper number is taken as written, whatever
  the employee's code.

### US-5: The release is safe to run, refuse and repeat

As the owner, I want the release to write nothing when anything is doubtful and to be repeatable, so
that the production books are never left half numbered.

**Acceptance criteria:**
- AC-5.1: Given any refusal (Accounting unreadable, auth unreadable for the names, register export or
  pairing file missing, malformed or stale, doubtful or unresolved lines, a shared prefix without a
  code), then nothing is written: no number, no counter, no baseline row, no default, no owner name,
  no marker and no audit entry of a number; and each family of refusal ends with an exit status of its own,
  the statuses 2, 3 and 4 keeping their meaning of 20261119 and 20261118.
- AC-5.2: Given a real run that fails after its checks, then it is rolled back as a whole and a rerun
  starts from the same state.
- AC-5.3: Given a completed release, when the real run is run again with any inputs, then it changes
  nothing, issues no number, writes no second marker, and reports that the release was already
  completed.
- AC-5.4: Given the release has not completed, then approvals keep answering 409
  `accounting_release_pending` (20261118 D6), and no number is consumed.
- AC-5.5: Given a dry run and a real run on the same data and inputs, then the numbers the dry run
  reports are those the real run writes.
- AC-5.6: Given the output of either run, its logs and its error messages, then they contain no
  employee name or email address and no register content other than paper numbers (no worker, no
  description, no reason, no amount of a row beyond a doubtful pairing's own amounts): employees appear as
  `<prefix> · <first 8 characters of the user id>`, lines by identifier, rows by their position in the
  export, and a malformed cell by its shape only. The register export and the pairing file are kept
  outside the repository, the run warns when either path is inside a git working tree, and neither
  file's content is stored by Refund.
- AC-5.7: Given the release, then the monthly batch, the export and the review work as before for lines
  that are not pre-release lines, and the WellD Italia lines stay unnumbered (20261118 AC-7.3).

## Amends

Amends specs/20261118-refund-accounting-export (status `done`) and specs/20261119-accounting. Where
an AC is not named here it stands as written.

- **20261118 AC-7.1** (the release's numbering of pre-release lines): replaced by US-1 and US-3 here.
  A pre-release line takes its paper number where the confirmed pairing says so, else a new number; the
  default account and the audit trail stay as in AC-7.1.
- **20261118 AC-7.4** (and 20261119 AC-7.4): the list of last hand-issued numbers is no longer the only
  input. A real run needs the register export and the confirmed pairing file (AC-2.8); `--offsets`
  stays accepted and complements them (AC-3.1). A missing input still writes nothing.
- **20261118 AC-4.11 and AC-4.12**: the counter continues after the highest of the offsets row, the
  register maximum and the imported numbers (AC-3.1); an employee with none starts at `001`.
- **20261118 AC-4.3**: "no gaps and no repeats" holds from the baseline on; gaps below it are paper
  numbers left unused (AC-3.6).
- **20261118 AC-4.2, AC-4.8 and the domain term "receipt number"**: the prefix is the employee's receipt
  code when there is one, else the initials; the format is `<2 or 3 letters><yy>/<seq>` (AC-4.4).
- **20261118 AC-4.6** (two employees with the same initials): sequences stay separate and the name stays
  beside the number; in addition, such employees need distinct receipt codes before they are issued a
  new number in the release (AC-4.11). After the release, see the open question on approvals.
- **20261118 AC-4.7** (a number never changes, is never reused): unchanged; only uniqueness within
  employee and year gets the split-receipt exception of AC-1.6 and AC-1.7 (AC-1.18).
- **20261118 Non-goals** "Importing the 2026 register" (the whole register is still not imported: only
  the paper numbers of paired pre-release lines are, AC-1.1, and the maxima are read from it) and "any
  check that the numbers Refund issues do not collide with other paper numbers beyond the one starting
  point per employee" (the pairing and the maximum are now such a check, for the numbers of 2026).
- **20261119 AC-7.2** (numbering unchanged, AC-4.1 to AC-4.13): read with the amendments above.
- **Release runbook** (infra/README.md, steps 7 and 8): its inputs change (the register export, the
  pairing file, the receipt codes set beforehand). A consequence for the plan, not specified here.

## Non-goals

- **The Excel detail extract in the style of sheet "2026"** (worker, period, number, description,
  from, to, reason, date, km, multiplier, total, account, VAT, approver). The accountant asked for it;
  it is a separate feature to specify next and does not block the release.
- **Importing the register into Refund**, keeping its rows, or reconciling it beyond pairing the
  pre-release lines and reading maxima. No register content other than a paper number is stored.
- **Matching on anything but employee, expense date and amount** (supplier, reason, account), and
  automatic acceptance of a doubtful pairing.
- **Correcting a number after the release.** Numbers are immutable (20261118 AC-4.7); a wrong pairing
  found later is handled in the books, not by renumbering.
- **Fixing the register**: wrong-year numbers, the `000` number, duplicates or rows without a number
  are listed, never edited.
- **A screen for the pairing.** The decision is made in the pairing file; no Refund UI is added.
- **Receipt codes per year, per entity, for people who have never filed in Refund**, or chosen by
  employees; and any rule that generates a code.
- **Changing a number issued by Refund before this feature** (none exist: the release has not run).
- **Numbering WellD Italia lines** (20261118 AC-7.3).
- **Hand numbering in the register after the release.** What the accountant does afterwards is a process
  question (open questions).
- **Naming employees in this spec.** Which employee holds which receipt code is release data entered by
  accounting (US-4), not spec text.

## Constraints

*Decisions taken by the owner on 2026-11-24, captured verbatim for the plan.*

- Pre-release lines that correspond to a register row TAKE THE PAPER NUMBER (no second number); lines
  with no paper counterpart take a new number after the employee's maximum; doubtful matches (same
  date, different amount; several candidates) are listed for a person to confirm before the real
  release run.
- A per-employee receipt code of 2 or 3 letters (A-Z) set by accounting, used instead of the initials
  derived from the name; numbers already issued (paper, or imported) never change; new numbers continue
  the SAME per-employee sequence with the new code (e.g. last paper `LC26/039`, next `LCX26/040`).
- The three-letter code is the rule for employees whose initials are shared, from now on. The codes
  are LCM and LCP (the two "LC" employees) and FRO and FRI (the two "FR" employees); the assignment
  to people is entered by accounting.
- The release reads the register export (supplied by the operator and kept outside the repo, like the
  offsets list) and the dry run lists doubtful and unmatched cases before the real run.
- The owner's test account is a test account: it must not be considered for the baseline; its lines may
  get their own sequence.
- Facts established on production on 2026-11-24, read-only: Refund 0.4.0 is deployed and the release
  has not run; 88 WellD CH 2026 lines of 9 employees were approved or paid before it; 77 match a
  register row exactly, 8 match the date with another amount, 3 match nothing.

## Open questions

- [x] The four three-letter codes for the two pairs of employees that share initials. — owner:
  accounting — **answered 2026-11-24 by the owner and accounting: LCM and LCP for the two "LC"
  employees, FRO and FRI for the two "FR" employees. Who holds which is release data entered by
  accounting (US-4) before the real release run (AC-4.11), not part of this spec.**
- [x] The owner's test account (3 pre-release lines): excluded from the release altogether (its lines
  left unnumbered), or numbered in its own sequence? Fallback: its own sequence from `001`, which needs
  a code of its own because its initials equal those of the owner's real account. — owner: Matteo
  Codogno **Answered 2026-11-24 by Matteo Codogno: "do not consider it" — it is excluded from the
  register (AC-1.15); its lines follow the fallback (own sequence, own code), never paired with paper.**
- [ ] The monthly statement rows (motorway, telematics) of the register, unnumbered and being
  renumbered: no answer yet. Fallback (AC-1.13): a register row without a receipt number is treated as
  having no paper number, so an Operai line matching it takes a new number after the employee's
  maximum, listed in the dry run for confirmation. Open: is the export for the release taken after the
  renumbering is finished, and how do statement rows, which carry a period and no expense date, pair
  with Operai lines (fallback: never automatically, a person pairs them by hand in the pairing file)?
  — owner: accounting
- [ ] Which amount does the register's "Total" hold for a line in a foreign currency: the original
  currency or CHF? Fallback: compared with the approved total in the line's own currency, so a foreign
  line with a different figure is "amount differs" and is decided by a person (AC-1.3). — owner:
  accounting
- [ ] Wrong-year numbers (`LG25/001-007` on 2026 expenses, then `LG26/008`): taken as written, or
  does accounting correct them in the register first? Fallback: decided line by line by a person
  (AC-1.10); the numbers count toward the maximum. — owner: accounting
- [ ] The `..26/000` number (a highlighted legacy reimbursement): taken as written, or a new number?
  Fallback: a new number (AC-1.11). — owner: accounting
- [ ] Who confirms the doubtful and unmatched cases (11 lines today) and who maps the register's workers
  to Operai employees? Fallback: accounting decides, the owner runs the release with its file. — owner:
  Matteo Codogno
- [ ] Cut-off: from the release on, does accounting stop numbering by hand the expenses that Refund
  numbers (a number written by hand after the export, for example in November, could repeat a number
  Refund issues)? What is the last register date covered by the export? — owner: accounting
- [ ] Where and by whom the receipt code is managed: fallback, Refund's Settings, for a capability held
  by the accounting role and the admin role (AC-4.9); or the Accounting app. — owner: Matteo Codogno
- [ ] After the release, when an employee's prefix is shared with another employee who has no code,
  should the approval be refused until a code is set, or only flagged to accounting? Fallback: not
  refused, name beside the number (20261118 AC-4.6), flagged in review. — owner: Matteo Codogno
- [ ] If a wrong pairing is found after the release, what is the remedy, given that numbers are
  immutable? Fallback: accounting corrects its register and the books by hand. — owner: accounting
