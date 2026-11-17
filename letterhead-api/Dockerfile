# letterhead-api — Rust, Typst embedded as a library (ADR 20261116-letterhead-api-is-a-rust-service-with-typst-embedded-for-document-layout-only).
# Build context: this directory (`docker build letterhead-api`).
#
# ─── Build stage ─────────────────────────────────────────────────────────────
# RUST_VERSION is the toolchain pinned in the repo root's mise.toml (`rust`); change them together.
ARG RUST_VERSION=1.100.0
FROM rust:${RUST_VERSION}-bookworm AS builder

WORKDIR /build

# Dependencies first: the layer below is rebuilt only when a manifest or Cargo.lock changes.
COPY Cargo.toml Cargo.lock ./
COPY engine/Cargo.toml engine/Cargo.toml
COPY api/Cargo.toml api/Cargo.toml
# `api/tests/pool.rs`: the manifest declares that test target (`harness = false`), and Cargo refuses to read a
# manifest whose declared target has no file, even for a build that does not build tests.
RUN mkdir -p engine/src api/src api/tests \
    && touch engine/src/lib.rs api/tests/pool.rs \
    && echo 'fn main() {}' > api/src/main.rs \
    && cargo build --release --locked -p letterhead-api \
    && rm -rf engine/src api/src api/tests

# The real sources. `touch` makes them newer than the placeholders built above.
COPY engine engine
COPY api api
RUN touch engine/src/lib.rs api/src/main.rs \
    && cargo build --release --locked -p letterhead-api

# ─── Production stage ─────────────────────────────────────────────────────────
# One binary: the supervisor, `letterhead-api migrate` (embedded migrations), and the worker the supervisor
# spawns as `letterhead-api worker`.
# ca-certificates: the supervisor calls the bucket over HTTPS. No curl or wget: the HEALTHCHECK is the
# binary itself.
FROM debian:bookworm-slim AS production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 letterhead \
    && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin letterhead

COPY --from=builder /build/target/release/letterhead-api /usr/local/bin/letterhead-api

# Drop privileges before the process starts: this service handles document content and client data.
USER letterhead

ENV PORT=8088
EXPOSE 8088

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD ["letterhead-api", "healthcheck"]

# CMD, not ENTRYPOINT (amendment 2026-11-17, item 4): Railway's `start` and `preDeploy` are whole commands, and
# whether it appends them to the entrypoint or replaces it, `letterhead-api migrate` must mean exactly that. With
# an ENTRYPOINT kept, a `preDeploy` of `letterhead-api migrate` could run `letterhead-api letterhead-api migrate`.
# `docker run <image>` still starts the service; compose's one-shot migration service says `command: [..., "migrate"]`.
CMD ["letterhead-api"]
