# Releasing Operai

The generic release procedure (dry-run first, explicit confirmation, clean tree) is
WellForge's, run by `/wellforge:release`. This file is Operai's half: what to check before,
how Operai cuts a release, what happens after, and what a release must never do. The team
owns it. A person releasing by hand follows the same steps in the same order.

Operai releases with **Changesets** (see `.changeset/README.md`), not release-it: each app
has its own SemVer version, and an umbrella `operai` version is bumped by the largest app
bump in the release. Nothing is published to a registry.

## Before

Any failing check stops the release.

- On `main`, working tree clean, up to date with `origin/main`.
- Contract checks: `mise run env:doctor`, `mise run shared:check`, `mise run react:skew`.
- Design system and its consumers: `mise run ui:check`.
- Railway matches the code: `railway config plan` shows no drift and nothing destructive
  against `.railway/railway.ts` (ADR 20261113-railway-infrastructure-as-code). If it shows
  something destructive, a person reads it before anything else happens.
- There is something to release: `pnpm exec changeset status --verbose` lists at least one
  pending changeset.

## Release

Preview (the dry run; changes nothing):

```bash
pnpm exec changeset status --verbose   # which apps bump, by how much, from which changesets
```

Release:

```bash
mise run release:version   # bumps the version of each changed app, then the umbrella operai version,
                           # and writes the CHANGELOGs and shell/src/lib/suiteVersion.generated.json
git add -A && git commit -m "chore(release): cut operai <X.Y.Z> (<app> <a.b.c>, …)"
mise run release:tag       # tags the commit: operai@<X.Y.Z> + @operai/<app>@<a.b.c> per bumped app
git push --follow-tags     # main + tags; pushing main deploys every Vercel frontend and Railway backend
```

Review the version commit (the bumps and the root `CHANGELOG.md` entry) before tagging.
`release:tag` does not push. The push is the outward-facing step and needs its own go.

## After

In order, after the push:

- If the release introduces a cross-service env var or a new service scope, set it in
  production, then check the contract with the real values:
  `mise run env:doctor -- --env production --resolve`.
- Check that the new version is online: `https://operai.welld.io/version.json` must answer
  `{"version":"<X.Y.Z>"}` with the version just tagged once the shell's Vercel deploy is
  live. Each backend's `GET /health` reports that service's own version. (The public
  version endpoint is still to be built: until then, open the About modal on
  https://operai.welld.io.)

## Never

- Never version or tag from a branch other than `main`.
- Never publish to npm or any registry: every app is `private`.
- Never edit an applied Prisma migration to get a release through. Add a new migration.
