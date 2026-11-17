#!/usr/bin/env bun
/**
 * Seeds ONE letterhead version for ONE entity (`--entity welld_it`, the default, or `welld_ch`) into a local database and
 * bucket, so that `render-perf.ts` and crm-api's contract test have something to render on without the person routes
 * (specs/20261116-letterhead-service, T13; the `--entity` option, T35).
 *
 * LOCAL ONLY. It writes straight into the tables (`letterhead_asset`, `letterhead_version`,
 * `letterhead_version_asset`, `letterhead_change`; the schema is `api/migrations/20261116000001_init.sql`) and puts the
 * assets in the bucket under `assets/<id>`, the key the service reads. The deployed service is never seeded this way:
 * once the person routes exist, a letterhead is saved through them. One entity per run: it seeds `welld_ch` or
 * `welld_it`, never both at once, and the version it writes is that entity's version 1.
 *
 * What it seeds is the golden corpus's `brand` letterhead (`engine/tests/golden/letterheads/brand.json`: first, middle
 * and last page differ, logo, background band) with its assets from `engine/tests/golden/assets/`, as layout 1.
 *
 * Safe to run again: every insert is `on conflict do nothing`, and the bucket is created only if absent. It never
 * deletes or updates (the tables refuse both) and never drops a database.
 *
 *   bun letterhead-api/perf/seed-local.ts \
 *     --database-url postgresql://postgres:postgres@localhost:5435/letterhead_lh_t13 \
 *     --s3-endpoint http://localhost:9000 --bucket letterhead-lh-t13 [--entity welld_it|welld_ch]
 *
 * The S3 keys come from LETTERHEAD_S3_ACCESS_KEY_ID / LETTERHEAD_S3_SECRET_ACCESS_KEY (default minioadmin, the
 * local MinIO of compose.yaml). The database must already exist and `letterhead-api migrate` must have run on it.
 */
import { SQL } from "bun";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "engine", "tests", "golden");
const ENTITIES = ["welld_it", "welld_ch"] as const;
const LAYOUT_VERSION = 1; // engine/src/layout/mod.rs CURRENT_LAYOUT
const CREATED_BY = "perf-seed";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (!value) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return value;
}

const entityArg = arg("entity", "welld_it");
if (!(ENTITIES as readonly string[]).includes(entityArg)) {
  console.error(`--entity must be one of ${ENTITIES.join(", ")}`);
  process.exit(2);
}
const ENTITY = entityArg as (typeof ENTITIES)[number];
const databaseUrl = arg("database-url");
const endpoint = arg("s3-endpoint", "http://localhost:9000").replace(/\/+$/, "");
const bucket = arg("bucket");
const accessKey = process.env.LETTERHEAD_S3_ACCESS_KEY_ID ?? "minioadmin";
const secretKey = process.env.LETTERHEAD_S3_SECRET_ACCESS_KEY ?? "minioadmin";
const REGION = "us-east-1"; // MinIO ignores it

// LOCAL ONLY, and enforced: the rows this writes can never be removed (the tables refuse UPDATE and DELETE, by design),
// and a version 1 for the entity would make the first real save of the entity a `version_conflict`. So both the database
// and the S3 endpoint must be on this machine or its Docker, whatever the arguments say.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "postgres", "minio"]);
for (const [what, value] of [["--database-url", databaseUrl], ["--s3-endpoint", endpoint]] as const) {
  let host = "";
  try {
    host = new URL(value).hostname;
  } catch {
    // a value that is not a URL has no host and is refused below
  }
  if (!LOCAL_HOSTS.has(host)) {
    console.error(`seed-local: ${what} must point at a local host (localhost, 127.0.0.1, host.docker.internal, postgres, minio); this script never seeds a deployed environment`);
    process.exit(2);
  }
}
if (!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket)) {
  console.error("--bucket is not a valid bucket name");
  process.exit(2);
}

// --- the letterhead and its assets -------------------------------------------------------------------------

type Asset = { id: string; kind: "logo" | "background"; format: "png" | "svg"; bytes: Buffer; width?: number; height?: number };

// An asset id is the table's primary key, whatever the entity, and a version may only use assets of its own entity
// (the foreign key is on `(asset_id, entity)`). So `welld_it` keeps the golden corpus's ids, as it always did, and any other
// entity gets ids of its own, derived from the golden ones: the same letterhead for both entities can then live in one
// database. The golden files are still found by the original id; only the id the rows, the bucket and the configuration
// carry changes.
function idFor(golden: string): string {
  if (ENTITY === "welld_it") return golden;
  const h = createHash("sha256").update(`${ENTITY}:${golden}`).digest("hex");
  const variant = "89ab"[parseInt(h[16], 16) % 4];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const goldenConfig = readFileSync(join(GOLDEN, "letterheads", "brand.json"), "utf8");
const goldenIds = [...new Set(goldenConfig.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])];
const config = JSON.parse(goldenIds.reduce((text, id) => text.replaceAll(id, idFor(id)), goldenConfig));
const ownToGolden = new Map(goldenIds.map((id) => [idFor(id), id]));

const wanted = new Map<string, "logo" | "background">();
for (const variant of Object.values<any>(config.variants)) {
  if (variant.logo?.asset) wanted.set(variant.logo.asset, "logo");
  if (variant.background) wanted.set(variant.background, "background");
}

const assets: Asset[] = [];
for (const [id, kind] of wanted) {
  const file = ownToGolden.get(id) ?? id;
  const png = join(GOLDEN, "assets", `${file}.png`);
  const svg = join(GOLDEN, "assets", `${file}.svg`);
  let bytes: Buffer;
  let format: "png" | "svg";
  try {
    bytes = readFileSync(png);
    format = "png";
  } catch {
    bytes = readFileSync(svg);
    format = "svg";
  }
  const asset: Asset = { id, kind, format, bytes };
  if (format === "png") {
    // IHDR: 8-byte signature, 4-byte length, "IHDR", then width and height as big-endian u32.
    asset.width = bytes.readUInt32BE(16);
    asset.height = bytes.readUInt32BE(20);
  }
  assets.push(asset);
}

// --- S3 (SigV4, path style; what MinIO speaks) -------------------------------------------------------------

const sha256hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

async function s3(method: "PUT" | "HEAD", path: string, body: Buffer = Buffer.alloc(0)): Promise<Response> {
  const url = new URL(endpoint + path);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${REGION}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), REGION), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return fetch(url, {
    method,
    headers: {
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: method === "PUT" && body.length > 0 ? body : undefined,
  });
}

const head = await s3("HEAD", `/${bucket}`);
if (head.status === 404) {
  const made = await s3("PUT", `/${bucket}`);
  if (!made.ok) throw new Error(`could not create bucket ${bucket}: HTTP ${made.status}`);
  console.log(`bucket ${bucket}: created`);
} else if (head.ok) {
  console.log(`bucket ${bucket}: exists`);
} else {
  throw new Error(`bucket ${bucket}: HEAD answered HTTP ${head.status}`);
}
for (const asset of assets) {
  const put = await s3("PUT", `/${bucket}/assets/${asset.id}`, asset.bytes);
  if (!put.ok) throw new Error(`could not put assets/${asset.id}: HTTP ${put.status}`);
}
console.log(`bucket ${bucket}: ${assets.length} assets in place`);

// --- Postgres -----------------------------------------------------------------------------------------------

const sql = new SQL(databaseUrl);
try {
  await sql.begin(async (tx) => {
    for (const a of assets) {
      await tx`insert into letterhead_asset (id, entity, kind, format, sha256, bytes, width_px, height_px, created_by)
               values (${a.id}::uuid, ${ENTITY}, ${a.kind}, ${a.format}, ${createHash("sha256").update(a.bytes).digest()},
                       ${a.bytes.length}, ${a.width ?? null}, ${a.height ?? null}, ${CREATED_BY})
               on conflict do nothing`;
    }
    await tx`insert into letterhead_version (entity, version, layout_version, config, created_by)
             values (${ENTITY}, 1, ${LAYOUT_VERSION}, ${config}::jsonb, ${CREATED_BY})
             on conflict do nothing`;
    for (const a of assets) {
      await tx`insert into letterhead_version_asset (entity, version, asset_id) values (${ENTITY}, 1, ${a.id}::uuid)
               on conflict do nothing`;
    }
    await tx`insert into letterhead_change (entity, version, action, actor_sub, actor_name, changed_settings)
             values (${ENTITY}, 1, 'save', ${CREATED_BY}, ${CREATED_BY}, ${["margins", "fonts", "look.headings"]}::text[])
             on conflict do nothing`;
  });
  const [{ n }] = await sql`select count(*)::int as n from letterhead_version where entity = ${ENTITY}`;
  console.log(`database: ${ENTITY} has ${n} version(s); active = the highest`);
} finally {
  await sql.close();
}
