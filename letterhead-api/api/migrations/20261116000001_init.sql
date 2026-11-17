-- letterhead-api: versions, assets and the change record (specs/20261116-letterhead-service, plan § Data model).
--
-- A letterhead version is the layout of every document made with it, and none is ever deleted (AC-4.6). So
-- the tables that say what a version is, and who made it, cannot be changed or removed, by any path to the
-- database: not by a route, a migration run by mistake, a query in production, a future admin tool. The
-- mechanism is a `BEFORE UPDATE OR DELETE` trigger that raises, the pattern of
-- refund-api/prisma/migrations/20260716133804_init (ADR 20261116-letterhead-versions-assets-and-change-record-
-- are-immutable-in-the-database, Tier 1 of ADR 20260804-two-tier-audit-assurance-auth-audit-log-application-level).
-- The foreign keys are ON DELETE RESTRICT, never CASCADE or SET NULL: both are writes the trigger would have to
-- let through, or abort.
--
-- Not covered by a row trigger, as in the refund trail: TRUNCATE, DROP TABLE and a superuser who disables the
-- triggers (see the ADR, Risks).
--
-- Never edit this file once it has been applied anywhere; add a migration. `created_by`, `actor_sub` and
-- `actor_name` are plain text with no foreign key to any user table: the service has no link to `auth`'s users.

create table letterhead_asset (
  id          uuid primary key,                -- server-chosen; the bucket key is assets/<id>
  entity      text not null check (entity in ('welld_it', 'welld_ch')),
  kind        text not null check (kind in ('logo', 'background')),
  format      text not null check (format in ('png', 'jpeg', 'svg')),   -- sniffed from the bytes (AC-7.1)
  sha256      bytea not null check (octet_length(sha256) = 32),
  bytes       int not null check (bytes > 0 and bytes <= 2097152),      -- AC-7.3
  width_px    int check (width_px > 0),
  height_px   int check (height_px > 0),
  created_by  text not null check (created_by <> ''),
  created_at  timestamptz not null default now(),
  constraint letterhead_asset_id_entity_key unique (id, entity),
  -- A raster has a pixel size, an SVG has none.
  constraint letterhead_asset_size_check check (
    (format = 'svg' and width_px is null and height_px is null)
    or (format <> 'svg' and width_px is not null and height_px is not null)
  )
);

create table letterhead_version (
  entity          text not null check (entity in ('welld_it', 'welld_ch')),
  version         int not null check (version >= 1),
  layout_version  int not null check (layout_version >= 1),                 -- ADR 20261116-a-letterhead-version-pins-its-layout...
  config          jsonb not null check (jsonb_typeof(config) = 'object'),   -- LetterheadConfig v1, asset ids inside
  created_by      text not null check (created_by <> ''),
  created_at      timestamptz not null default now(),
  restored_from   int,                                                      -- AC-4.2
  primary key (entity, version),
  constraint letterhead_version_restored_from_fk foreign key (entity, restored_from)
    references letterhead_version (entity, version) on delete restrict,
  constraint letterhead_version_restored_from_check check (restored_from is null or restored_from < version)
);

-- Which assets a version uses (AC-4.6). The composite key to the asset keeps a version to its own entity's
-- assets: a welld_ch version cannot point at a welld_it logo.
create table letterhead_version_asset (
  entity    text not null,
  version   int not null,
  asset_id  uuid not null,
  primary key (entity, version, asset_id),
  constraint letterhead_version_asset_version_fk foreign key (entity, version)
    references letterhead_version (entity, version) on delete restrict,
  constraint letterhead_version_asset_asset_fk foreign key (asset_id, entity)
    references letterhead_asset (id, entity) on delete restrict
);

-- Who made each version, when, and the names of the settings that changed (AC-4.7). Keys only: never a value,
-- never document content (AC-3.7).
create table letterhead_change (
  id                bigserial primary key,
  entity            text not null,
  version           int not null,
  action            text not null check (action in ('save', 'restore')),
  actor_sub         text not null check (actor_sub <> ''),
  actor_name        text not null check (actor_name <> ''),
  at                timestamptz not null default now(),
  changed_settings  text[] not null,
  restored_from     int,
  constraint letterhead_change_version_fk foreign key (entity, version)
    references letterhead_version (entity, version) on delete restrict,
  -- One record per version: the one save or restore that made it.
  constraint letterhead_change_version_key unique (entity, version),
  constraint letterhead_change_restore_check check ((action = 'restore') = (restored_from is not null))
);

-- Immutability. `TG_TABLE_NAME` in the message names the table; the key is deliberately not printed (a
-- version's config is not in the message).
create function letterhead_refuse_change() returns trigger as $$
begin
  raise exception 'letterhead_immutable: % of a % row is refused; rows of this table are never changed or removed',
    tg_op, tg_table_name
    using errcode = 'raise_exception';
end;
$$ language plpgsql;

create trigger letterhead_version_immutable
  before update or delete on letterhead_version
  for each row execute function letterhead_refuse_change();

create trigger letterhead_version_asset_immutable
  before update or delete on letterhead_version_asset
  for each row execute function letterhead_refuse_change();

create trigger letterhead_change_immutable
  before update or delete on letterhead_change
  for each row execute function letterhead_refuse_change();

-- An asset is never updated. It may be deleted only while no version uses it: an upload that was never saved is
-- swept after 24 hours (the sweep deletes the bucket object too).
create function letterhead_guard_asset() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'letterhead_immutable: UPDATE of a letterhead_asset row is refused; assets are never changed'
      using errcode = 'raise_exception';
  end if;
  if exists (select 1 from letterhead_version_asset where asset_id = old.id) then
    raise exception 'letterhead_immutable: DELETE of a letterhead_asset row that a version uses is refused'
      using errcode = 'raise_exception';
  end if;
  return old;
end;
$$ language plpgsql;

create trigger letterhead_asset_guard
  before update or delete on letterhead_asset
  for each row execute function letterhead_guard_asset();
