#!/usr/bin/env bash
# residue-check.sh — "nothing of a document is kept anywhere" (AC-3.7), against a RUNNING letterhead-api.
#
# The same check as api/tests/residue.rs, for a human, on the compose stack (or on any container set that follows
# the same shape). It renders documents that carry unique marker strings (a success and several refusals, on both
# service routes, and, with a person token, the configurator's preview), then searches for the markers in:
#
#   1. the Postgres database, in full (`pg_dump`);
#   2. every object of the bucket (keys and bytes);
#   3. the whole filesystem of the service's container, /tmp and /dev/shm included, and `docker diff`, which must
#      show nothing new after the renders that it did not show before;
#   4. the container's captured logs (stdout and stderr), and those of the database and the bucket;
#   5. the container's environment: no metrics or trace exporter is configured.
#
# A marker is looked for as typed, as hex (a `bytea`), and as base64 in each of its three alignments.
#
# Usage, from the repository root, with the stack up (`docker compose up -d`) and a letterhead saved for welld_it:
#
#   AUTH_URL=http://localhost:3001 RESIDUE_CLIENT_ID=<service client with scope letterhead:render> \
#   RESIDUE_CLIENT_SECRET=<its secret> letterhead-api/scripts/residue-check.sh
#
#   (or LETTERHEAD_TOKEN=<a service token> instead of the three above;
#    add LETTERHEAD_PERSON_TOKEN=<a person token with access to the letterheads tool> to cover the configurator's
#    preview, drawn and refused. The configurator's SAVE is not exercised here: it would create a letterhead
#    version.)
#
# Settings (environment), with their defaults for compose:
#   LETTERHEAD_URL          http://localhost:8088
#   COMPOSE                 docker compose            (how the service names are resolved to containers)
#   RESIDUE_API_CONTAINER   $COMPOSE ps -q letterhead-api
#   RESIDUE_PG_CONTAINER    $COMPOSE ps -q postgres
#   RESIDUE_S3_CONTAINER    $COMPOSE ps -q minio      (a Bitnami MinIO image: it carries `mc`)
#   RESIDUE_PG_USER         postgres        RESIDUE_PG_DB     letterhead
#   RESIDUE_S3_BUCKET       letterhead      RESIDUE_S3_USER   minioadmin     RESIDUE_S3_PASSWORD  minioadmin
#   RESIDUE_NO_CONTROLS     1 to skip the positive controls that write a marker (a file in the container's /tmp and
#                           an object in the bucket, both removed at once), e.g. on a container that is read-only
#                           or write-denied
#
# What it does NOT do: it does not look inside the memory of a process, nor at a swap file or a core dump of the
# host; and a PDF is compressed, so a copy of one left on a disk would not hold a marker as text: that is why the
# container's filesystem is also compared with `docker diff` before and after.
#
# Exit status: 0 no marker anywhere, and every control found; 1 a marker (or a new file, or an exporter) was
# found: the places are listed; 2 the check could not be made (a container, a credential, a letterhead is
# missing). Nothing is written to the host's disk but a temporary directory that is removed at the end.

set -u
set -o pipefail

URL=${LETTERHEAD_URL:-http://localhost:8088}
COMPOSE=${COMPOSE:-docker compose}
PG_USER=${RESIDUE_PG_USER:-postgres}
PG_DB=${RESIDUE_PG_DB:-letterhead}
BUCKET=${RESIDUE_S3_BUCKET:-letterhead}
S3_USER=${RESIDUE_S3_USER:-minioadmin}
S3_PASSWORD=${RESIDUE_S3_PASSWORD:-minioadmin}

die() { echo "residue-check: $*" >&2; exit 2; }
say() { printf '%s\n' "$*"; }

command -v docker >/dev/null 2>&1 || die "docker is needed (the stores are searched through their containers)"
command -v curl >/dev/null 2>&1 || die "curl is needed"
command -v base64 >/dev/null 2>&1 || die "base64 is needed"

API=${RESIDUE_API_CONTAINER:-$($COMPOSE ps -q letterhead-api 2>/dev/null | head -n1)}
PG=${RESIDUE_PG_CONTAINER:-$($COMPOSE ps -q postgres 2>/dev/null | head -n1)}
S3=${RESIDUE_S3_CONTAINER:-$($COMPOSE ps -q minio 2>/dev/null | head -n1)}
[ -n "$API" ] || die "no letterhead-api container (is the stack up? or set RESIDUE_API_CONTAINER)"
[ -n "$PG" ] || die "no postgres container (set RESIDUE_PG_CONTAINER)"
[ -n "$S3" ] || die "no minio container (set RESIDUE_S3_CONTAINER)"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/residue-check.XXXXXX") || die "cannot make a temporary directory"
cleanup() {
  rm -rf "$WORK"
  if [ -n "${CONTROL_FILE:-}" ]; then
    docker exec -u 0 "$API" rm -f "$CONTROL_FILE" >/dev/null 2>&1
  fi
  if [ -n "${CONTROL_KEY:-}" ]; then
    mc rm --quiet "local/$BUCKET/$CONTROL_KEY" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

mc() { docker exec -e "MC_HOST_local=http://$S3_USER:$S3_PASSWORD@localhost:9000" "$S3" mc "$@"; }

# ---------------------------------------------------------------------------------------------------------------
# The markers, and the forms they are searched in

RUN=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
# Every marker of a request that must leave nothing. The script writes their texts to $WORK/markers (one per line).
marker() { local m="ZQX-RES-$1-$RUN"; echo "$m" >> "$WORK/markers"; printf '%s' "$m"; }
: > "$WORK/markers"

# The forms of one marker, one pattern per line: as typed, as hex, and the three base64 alignments (the characters
# that the marker's own bytes fix: from after the pad's to the last whole character before what follows).
forms_of() {
  local m=$1 len pad skip end enc
  printf '%s\n' "$m"
  printf '%s' "$m" | od -An -tx1 | tr -d ' \n'; echo
  len=${#m}
  for spec in "0 0" "1 2" "2 3"; do
    set -- $spec; pad=$1; skip=$2
    enc=$( { [ "$pad" -gt 0 ] && head -c "$pad" /dev/zero; printf '%s' "$m"; printf '###'; } | base64 | tr -d '\n=')
    end=$(( (pad + len) * 8 / 6 ))
    printf '%s\n' "$enc" | cut -c "$((skip + 1))-$end"
  done
}

build_patterns() { # $1 markers file, $2 patterns file
  : > "$2"
  while IFS= read -r m; do [ -n "$m" ] && forms_of "$m" >> "$2"; done < "$1"
}

# ---------------------------------------------------------------------------------------------------------------
# A credential

TOKEN=${LETTERHEAD_TOKEN:-}
if [ -z "$TOKEN" ]; then
  [ -n "${AUTH_URL:-}" ] && [ -n "${RESIDUE_CLIENT_ID:-}" ] && [ -n "${RESIDUE_CLIENT_SECRET:-}" ] \
    || die "no credential: set LETTERHEAD_TOKEN, or AUTH_URL with RESIDUE_CLIENT_ID and RESIDUE_CLIENT_SECRET"
  answer=$(curl -s -m 20 -H 'content-type: application/json' \
    -d "{\"clientId\":\"$RESIDUE_CLIENT_ID\",\"clientSecret\":\"$RESIDUE_CLIENT_SECRET\"}" \
    "$AUTH_URL/system/service-token") || die "auth did not answer at $AUTH_URL"
  TOKEN=$(printf '%s' "$answer" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  [ -n "$TOKEN" ] || die "auth gave no token (is the client's scope letterhead:render?)"
fi
PERSON=${LETTERHEAD_PERSON_TOKEN:-}

# ---------------------------------------------------------------------------------------------------------------
# Before: the service answers, a letterhead exists, and what the stores hold now

[ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$URL/health")" = 200 ] || die "$URL/health does not answer 200"
status=$(curl -s -m 10 -H "authorization: Bearer $TOKEN" "$URL/v1/letterheads/status") || die "no answer from $URL"
case "$status" in
  *'"welld_it"'*) ;;
  *) die "GET /v1/letterheads/status gave an answer without welld_it: $status" ;;
esac

docker diff "$API" | sort > "$WORK/diff.before" || die "docker diff failed"
mc find "local/$BUCKET" 2>/dev/null | sort > "$WORK/bucket.before" || die "cannot list the bucket $BUCKET (RESIDUE_S3_*)"
LOGS_BEFORE=$(docker logs "$API" 2>&1 | grep -c '^render route=')

# ---------------------------------------------------------------------------------------------------------------
# The renders

REQUESTS=0
FAILED_EXPECTATIONS=0
post() { # $1 label, $2 expected status, $3 path, $4 bearer ("" for none), $5 body
  local label=$1 want=$2 path=$3 bearer=$4 body=$5 got
  local auth=()
  [ -n "$bearer" ] && auth=(-H "authorization: Bearer $bearer")
  got=$(printf '%s' "$body" | curl -s -o /dev/null -w '%{http_code}' -m 60 -H 'content-type: application/json' \
    "${auth[@]+"${auth[@]}"}" --data-binary @- "$URL$path")
  case "$path" in /v1/render/*) REQUESTS=$((REQUESTS + 1)) ;; esac
  if [ "$got" = "$want" ]; then
    say "  ok    $label -> $got"
  else
    say "  FAIL  $label -> $got (expected $want)"; FAILED_EXPECTATIONS=$((FAILED_EXPECTATIONS + 1))
  fi
}

# A document with a marker in every place of the content that can hold text.
document() { # $1 tag
  local t=$1
  printf '{"contentVersion":1,"entity":"welld_it","language":"en",'
  printf '"entityData":{"legalName":"%s","addressLines":["%s","%s"],"vat":"%s","iban":"%s","contacts":"%s"},' \
    "$(marker "$t-legalName")" "$(marker "$t-address1")" "$(marker "$t-address2")" "$(marker "$t-vat")" \
    "$(marker "$t-iban")" "$(marker "$t-contacts")"
  printf '"blocks":[{"type":"heading","level":1,"text":"%s"},' "$(marker "$t-heading")"
  printf '{"type":"paragraph","runs":[{"text":"%s"},{"text":"%s","bold":true}]},' "$(marker "$t-paragraph")" "$(marker "$t-run")"
  printf '{"type":"list","items":[{"runs":[{"text":"%s"}]}]},' "$(marker "$t-item")"
  printf '{"type":"table","columns":[1,1],"header":[[{"type":"paragraph","runs":[{"text":"%s"}]}],[{"type":"paragraph","runs":[{"text":"%s"}]}]],' \
    "$(marker "$t-th1")" "$(marker "$t-th2")"
  printf '"rows":[[[{"type":"paragraph","runs":[{"text":"%s"}]}],[{"type":"paragraph","runs":[{"text":"%s"}]}]]]}' \
    "$(marker "$t-td1")" "$(marker "$t-td2")"
  printf ']}'
}
with() { # $1 document, $2 sed expression: a change that makes it a refusal
  printf '%s' "$1" | sed "$2"
}

say "Rendering documents with markers ($URL):"
OK_DOC=$(document ok)
OK_DOC_PDF=$(document ok-pdf)
post "pdf, a document that is drawn" 200 /v1/render/pdf "$TOKEN" "$OK_DOC_PDF"
post "preview, a document that is drawn" 200 /v1/render/preview "$TOKEN" "$OK_DOC"
for route in /v1/render/pdf /v1/render/preview; do
  post "$route, a style that does not exist" 422 "$route" "$TOKEN" \
    "$(with "$(document refused-style)" 's/"bold":true/"style":"'"$(marker refused-style-name)"'"/')"
  post "$route, an entity that does not exist" 422 "$route" "$TOKEN" \
    "$(with "$(document refused-entity)" 's/"entity":"welld_it"/"entity":"'"$(marker refused-entity-name)"'"/')"
  post "$route, a letterhead version that does not exist" 404 "$route" "$TOKEN" \
    "$(with "$(document refused-version)" 's/"language":"en"/"language":"en","letterheadVersion":99/')"
  post "$route, a content version that is not supported" 422 "$route" "$TOKEN" \
    "$(with "$(document refused-contentversion)" 's/"contentVersion":1/"contentVersion":2/')"
  post "$route, a block that is not a block" 422 "$route" "$TOKEN" \
    "$(with "$(document refused-block)" 's/"type":"heading"/"type":"'"$(marker refused-block-type)"'"/')"
  post "$route, an image that names an address" 422 "$route" "$TOKEN" \
    "$(with "$(document refused-address)" 's#\]}$#,{"type":"image","url":"https://'"$(marker refused-url)"'.example/x.png"}]}#')"
done
post "pdf, not JSON" 422 /v1/render/pdf "$TOKEN" "$(marker refused-notjson)"
post "pdf, no credential" 401 /v1/render/pdf "" "$(document refused-nocredential)"
post "pdf, a credential that is not one" 401 /v1/render/pdf "$(marker refused-bearer)" "$(document refused-badcredential)"
if [ -n "$PERSON" ]; then
  say "The configurator's preview:"
  # A form that is certainly refused (a member that does not exist and a brace that does not close).
  post "preview of a form, refused" 422 /v1/letterheads/welld_it/preview "$PERSON" \
    "{\"config\":{\"margins\":{\"top\":25,\"$(marker preview-refused-member)\":1},\"text\":\"$(marker preview-refused-text){\"},\"language\":\"en\"}"
  post "preview, an entity that does not exist" 422 "/v1/letterheads/$(marker preview-entity)/preview" "$PERSON" \
    "{\"config\":{},\"language\":\"en\"}"
  post "preview, a language that does not exist" 422 /v1/letterheads/welld_it/preview "$PERSON" \
    "{\"config\":{},\"language\":\"$(marker preview-language)\"}"
  # A form that is drawn: the entity's active configuration with a marker in its header. This needs `jq`.
  if command -v jq >/dev/null 2>&1; then
    active=$(curl -s -m 10 -H "authorization: Bearer $PERSON" "$URL/v1/letterheads" | jq -r '.welld_it.activeVersion // empty')
    if [ -n "$active" ]; then
      form=$(curl -s -m 10 -H "authorization: Bearer $PERSON" "$URL/v1/letterheads/welld_it/versions/$active" \
        | jq -c --arg m "$(marker preview-drawn-header)" \
          '{config: (.config | .variants.default.header.left = [{bold: false, color: "1f2430", size: 9, text: {it: $m, en: $m}}]), language: "en"}')
      post "preview of a form, drawn" 200 /v1/letterheads/welld_it/preview "$PERSON" "$form"
      post "preview of a form, refused (a margin too wide)" 422 /v1/letterheads/welld_it/preview "$PERSON" \
        "$(printf '%s' "$form" | jq -c --arg m "$(marker preview-refused-margin)" '.config.margins.top = 500 | .config.margins[$m] = 1')"
    else
      say "  (welld_it has no active letterhead: the preview of a form that is drawn is not exercised)"
    fi
  else
    say "  (no jq: the preview of a form that is drawn is not exercised)"
  fi
else
  say "  (no LETTERHEAD_PERSON_TOKEN: the configurator's preview is not exercised)"
fi
[ "$FAILED_EXPECTATIONS" -eq 0 ] || die "$FAILED_EXPECTATIONS request(s) did not get the answer expected: the check would not mean what it says"

sleep 1

# ---------------------------------------------------------------------------------------------------------------
# The controls: a marker that IS stored must be found, or a zero means nothing

HITS=0
PROBLEMS=0
build_patterns "$WORK/markers" "$WORK/patterns"
NMARK=$(wc -l < "$WORK/markers" | tr -d ' ')
say "Searching $NMARK markers, $(wc -l < "$WORK/patterns" | tr -d ' ') patterns (as typed, hex, base64 x3):"

CONTROL_VALUE="ZQX-RES-control-$RUN"
printf '%s\n' "$CONTROL_VALUE" > "$WORK/control"
build_patterns "$WORK/control" "$WORK/control.patterns"
if [ "${RESIDUE_NO_CONTROLS:-0}" != 1 ]; then
  CONTROL_FILE="/tmp/.residue-control-$RUN"
  CONTROL_KEY="residue-control/$RUN"
  docker exec -u 0 "$API" sh -c "printf '%s' '$CONTROL_VALUE' > '$CONTROL_FILE'" || die "cannot plant the control file in the container (a read-only container? set RESIDUE_NO_CONTROLS=1)"
  printf '%s' "x $CONTROL_VALUE y" | docker exec -i -e "MC_HOST_local=http://$S3_USER:$S3_PASSWORD@localhost:9000" "$S3" mc pipe "local/$BUCKET/$CONTROL_KEY" >/dev/null \
    || die "cannot put the control object in the bucket"
fi

report() { # $1 place, $2 hits
  if [ "$2" -eq 0 ]; then say "  ok    $1: 0 hits"; else say "  HIT   $1: $2 hit(s)"; HITS=$((HITS + $2)); fi
}
control() { # $1 what, $2 hits found of the control
  if [ "$2" -gt 0 ]; then say "  ok    control: $1 found"; else say "  FAIL  control: $1 NOT found, the search cannot see"; PROBLEMS=$((PROBLEMS + 1)); fi
}
count() { grep -a -c -F -f "$1" 2>/dev/null; true; } # reads stdin; prints the number of matching lines

# 1. Postgres, in full.
docker exec "$PG" pg_dump -U "$PG_USER" "$PG_DB" > "$WORK/pgdump" 2>"$WORK/pgdump.err" || die "pg_dump failed: $(head -n1 "$WORK/pgdump.err")"
grep -q 'letterhead_version' "$WORK/pgdump" || die "pg_dump of $PG_DB does not hold the letterhead tables: wrong RESIDUE_PG_DB?"
report "the database $PG_DB (pg_dump, $(wc -c < "$WORK/pgdump" | tr -d ' ') bytes)" "$(count "$WORK/patterns" < "$WORK/pgdump")"

# 2. The bucket: the keys and every object.
mc find "local/$BUCKET" 2>/dev/null | sort > "$WORK/bucket.after"
objects=0; bucket_hits=0; control_object_hits=0
: > "$WORK/bucket.dump"
while IFS= read -r object; do
  [ -n "$object" ] || continue
  objects=$((objects + 1))
  printf '%s\n' "$object" >> "$WORK/bucket.dump"
  mc cat "$object" >> "$WORK/bucket.dump" 2>/dev/null
  printf '\n' >> "$WORK/bucket.dump"
done < "$WORK/bucket.after"
bucket_hits=$(count "$WORK/patterns" < "$WORK/bucket.dump")
control_object_hits=$(count "$WORK/control.patterns" < "$WORK/bucket.dump")
report "the bucket $BUCKET ($objects object(s))" "$bucket_hits"
if [ "${RESIDUE_NO_CONTROLS:-0}" != 1 ]; then control "an object in the bucket" "$control_object_hits"; fi
# The keys that are not the control's are the keys that were there before.
grep -v "residue-control/$RUN" "$WORK/bucket.after" > "$WORK/bucket.after.clean"
if ! diff -q "$WORK/bucket.before" "$WORK/bucket.after.clean" >/dev/null; then
  say "  HIT   the bucket's keys changed during the renders:"; diff "$WORK/bucket.before" "$WORK/bucket.after.clean" | sed 's/^/          /'
  HITS=$((HITS + 1))
else
  say "  ok    the bucket holds the same keys as before"
fi

# 3. The container's filesystem: every file (the writable layer and the image), and what `docker diff` shows.
docker exec -i -u 0 "$API" sh -c \
  "grep -r -a -l -F -f - / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev 2>/dev/null; grep -r -a -l -F -f - /dev/shm 2>/dev/null; true" \
  < "$WORK/patterns" > "$WORK/fs.hits" 2>/dev/null
# The command line of the grep that runs now holds no marker (the patterns come on stdin), and /proc is not searched.
FS_HITS=$(grep -v -c '^$' "$WORK/fs.hits" 2>/dev/null; true)
report "the container's files (/, /tmp, /dev/shm)" "$FS_HITS"
[ "$FS_HITS" -eq 0 ] || sed 's/^/          /' "$WORK/fs.hits"
if [ "${RESIDUE_NO_CONTROLS:-0}" != 1 ]; then
  found=$(docker exec -i -u 0 "$API" sh -c "grep -r -a -l -F -f - /tmp 2>/dev/null; true" < "$WORK/control.patterns" | grep -c .)
  control "a file in the container's /tmp" "$found"
  docker exec -u 0 "$API" rm -f "$CONTROL_FILE" >/dev/null 2>&1; CONTROL_FILE=
  mc rm --quiet "local/$BUCKET/$CONTROL_KEY" >/dev/null 2>&1; CONTROL_KEY=
fi
docker diff "$API" | sort > "$WORK/diff.after"
if diff -q "$WORK/diff.before" "$WORK/diff.after" >/dev/null; then
  say "  ok    docker diff: nothing new in the container's filesystem ($(wc -l < "$WORK/diff.after" | tr -d ' ') entries, as before)"
else
  say "  HIT   docker diff: the container's filesystem changed during the renders:"
  diff "$WORK/diff.before" "$WORK/diff.after" | sed 's/^/          /'; HITS=$((HITS + 1))
fi

# 4. The logs, and that they were read: one `render route=` line for each request to a service route.
docker logs "$API" > "$WORK/logs" 2>&1
report "the service's logs" "$(count "$WORK/patterns" < "$WORK/logs")"
LOGS_AFTER=$(grep -c '^render route=' "$WORK/logs")
if [ $((LOGS_AFTER - LOGS_BEFORE)) -eq "$REQUESTS" ]; then
  say "  ok    control: the logs hold one line for each of the $REQUESTS requests to a service route"
else
  say "  FAIL  control: $((LOGS_AFTER - LOGS_BEFORE)) log line(s) for $REQUESTS request(s)"; PROBLEMS=$((PROBLEMS + 1))
fi
stray=$(grep -v -c -E '^(render route=[A-Za-z0-9:_.@=? -]*|letterhead-api listening on .*|authz: .*)$' "$WORK/logs"; true)
if [ "$stray" -gt 0 ]; then
  say "  HIT   $stray line(s) of the log are not of the service's three forms:"
  grep -v -E '^(render route=[A-Za-z0-9:_.@=? -]*|letterhead-api listening on .*|authz: .*)$' "$WORK/logs" | head -5 | cut -c1-160 | sed 's/^/          /'
  HITS=$((HITS + 1))
else
  say "  ok    every line of the log is of one of the service's forms"
fi
for other in "$PG" "$S3"; do
  report "the logs of $(docker inspect --format '{{.Name}}' "$other" | tr -d /)" "$(docker logs "$other" 2>&1 | count "$WORK/patterns")"
done

# 5. No exporter: the container's environment names none, and the listing of its sockets (if `ss` or `netstat`
#    exists there) is its own port.
exporters=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$API" \
  | grep -E -i '^(OTEL|SENTRY|DD_|DATADOG|STATSD|PROMETHEUS|JAEGER|ZIPKIN|NEW_RELIC|HONEYCOMB|RUST_LOG)' | sed 's/=.*//')
if [ -n "$exporters" ]; then
  say "  HIT   the container's environment configures an exporter or a logger: $(echo "$exporters" | tr '\n' ' ')"; HITS=$((HITS + 1))
else
  say "  ok    the container's environment configures no metrics or trace exporter"
fi

say ""
if [ "$PROBLEMS" -gt 0 ]; then
  say "residue-check: a control failed: the search is not trustworthy ($PROBLEMS)"; exit 2
fi
if [ "$HITS" -gt 0 ]; then
  say "residue-check: FAIL, $HITS finding(s). Something of a document is kept (AC-3.7)."; exit 1
fi
say "residue-check: PASS, no marker of $NMARK in the database, the bucket, the container's files, its logs; no exporter."
exit 0
