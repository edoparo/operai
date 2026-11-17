-- letterhead-api: TRUNCATE is refused on the four permanent tables (plan amendment 2026-11-17, item 5; AC-4.6, AC-4.7,
-- ADR 20261116-letterhead-versions-assets-and-change-record-are-immutable-in-the-database).
--
-- The row triggers of the init migration refuse every UPDATE and DELETE of a version, a version's asset link, a used
-- asset and a change row. TRUNCATE is neither: it deletes every row at once, fires no row trigger, and needs only
-- the ordinary table right, so a mistaken script or a test reset can issue it. A statement-level BEFORE TRUNCATE
-- trigger closes that.
--
-- It sits on all four tables, so a `TRUNCATE ... CASCADE` that starts from any table is refused too: the tables it
-- would reach through a foreign key are truncated "with" it, and their trigger fires before anything is removed.
--
-- Still not covered, as the ADR's Risks say: DROP TABLE, and an owner or superuser who disables the triggers.
-- No path of the service truncates: the sweep deletes unreferenced assets row by row.
--
-- The init migration is not edited (a migration that has been applied never is). The message starts with
-- `letterhead_immutable`, as the row triggers' do, so one test helper recognises both.

create function letterhead_refuse_truncate() returns trigger as $$
begin
  raise exception 'letterhead_immutable: TRUNCATE of % is refused; rows of this table are never removed', tg_table_name
    using errcode = 'raise_exception';
end;
$$ language plpgsql;

create trigger letterhead_asset_no_truncate
  before truncate on letterhead_asset
  for each statement execute function letterhead_refuse_truncate();

create trigger letterhead_version_no_truncate
  before truncate on letterhead_version
  for each statement execute function letterhead_refuse_truncate();

create trigger letterhead_version_asset_no_truncate
  before truncate on letterhead_version_asset
  for each statement execute function letterhead_refuse_truncate();

create trigger letterhead_change_no_truncate
  before truncate on letterhead_change
  for each statement execute function letterhead_refuse_truncate();
