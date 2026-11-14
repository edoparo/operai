---
name: provision-tool
description: Provision the production infrastructure of one Operai tool — Railway backend service on the shared Postgres (own logical database, optional EU bucket), Vercel project for its federated remote, custom domains, Cloudflare DNS records and the shell wiring. Use when a new tool (`<tool>-api` + `<tool>-ui`) must go to production, when asked to "create the service/project/bucket/DNS for <tool>", or to audit whether an existing tool's infrastructure is complete.
---

# Provision an Operai tool

The mechanical work is `infra/provision-tool.sh`. This skill is the part a script
cannot do: the order, the decisions that belong to a person, and the verification.

Run it in the main session. Do not hand the whole procedure to a subagent: it has
several points where the user must act or decide, and a subagent cannot stop to ask.

## Before anything

1. The tool is in the repo and wired: `<tool>-api/` (Dockerfile),
   `<tool>-ui/` (`vercel.json`), the shell reads `<TOOL>_REMOTE_URL` in
   `shell/vite.config.ts`, `shell/vercel.json`'s CSP names both hostnames, and
   `tools/env-doctor/templates/production/<tool>-api.env` exists. The script checks
   all of these and stops or flags what is missing.
2. **It is pushed to `main`.** Railway and Vercel build from GitHub.
3. Ask the user, once, what the script cannot know:
   - does the tool store files (then `--bucket`)?
   - is it backend-only or frontend-only (`--no-ui` / `--no-api`)?

## The procedure

```bash
./infra/provision-tool.sh <tool> [--bucket]            # 1. plan: read-only; prints the IaC block to add
# 2. add the block (and the bucket) to .railway/railway.ts WITHOUT a source, add it to resources, commit
./infra/provision-tool.sh <tool> [--bucket] --apply    # 3. database + `railway config apply` + variables + DNS
# 4. the user sets the remaining secrets in Railway (the script lists the names)
# 5. uncomment the block's `source: github(...)`, commit
./infra/provision-tool.sh <tool> [--bucket] --connect --redeploy-shell --apply   # 6. first build + shell
./infra/check.sh                                       # 7. finish line
```

The Railway service, its bucket and its custom domain are Railway IaC (ADR 20261113-railway-infrastructure-as-code,
`infra/README.md` § Railway configuration as code): you edit `.railway/railway.ts`,
the script only checks and applies it. Show the user the plan output — including
the `railway config plan` diff it prints — and get a yes before step 3; the apply
itself asks for confirmation too. **A plan that deletes anything is a stop**: in a
single-file setup a resource missing from the file is deleted, never pass
`--confirm-destructive`. Step 6 starts a production build and redeploys the shell:
confirm again before running it. If the
tool is not registered in `infra/check.sh` yet, add its checks as part of the work.

The script is safe to re-run: it only fills gaps, never overwrites a variable, never
deletes anything. A `✗` is a problem it would not touch; resolve it with the user.

## What stays with a person

- **Secrets.** The script sets no secret and reads none. Bucket credentials go in
  by reference (`${{<bucket>.ACCESS_KEY_ID}}`). Anything else secret is set by the
  user in the Railway dashboard, or as a reference to a shared variable. Never run
  a command that prints variable values (`railway variables --kv` or `--json`,
  `railway bucket credentials`) into the conversation; cut to names.
- **Bucket CORS.** Nothing here can set or read it. The browser uploads straight to
  the bucket from the shell origin, so the bucket needs a CORS rule for
  `https://operai.welld.io` and one real upload must be tested.
- **The decision to deploy.** `--connect` and `--redeploy-shell` are separate flags
  for that reason.
- **Who gets access.** Roles are assigned in Admin after the tool is live.

## Rules that came from doing this by hand (October 2026, inventory)

- **DNS records before any lookup.** Looking a hostname up before its record exists
  makes the resolver cache "no such host" for 30 minutes (the zone's negative TTL).
  A home router did exactly that and the tool looked broken on one network while it
  worked everywhere else. So: attach the domain, create the record at once, and
  never `curl`, `dig` (without `@1.1.1.1`) or open a new hostname until the script
  says it resolves. If someone is already stuck, the fix is to wait, use another
  DNS server, or restart the router; flushing the laptop's cache is not enough.
- **A Vercel project created after the push never builds on its own.** The script
  triggers the first production deployment.
- **Shell variables are build-time.** Setting `<TOOL>_REMOTE_URL` and
  `VITE_<TOOL>_API_URL` does nothing until the shell is redeployed. Check that the
  variables exist *before* redeploying; a redeploy without them looks successful.
- **Railway no longer reads `railway.json`** (Config as Code, gone after
  2026-12-01; a new service could not use it even before). Build and deploy settings,
  replicas, region and domain live in the service's block in `.railway/railway.ts`.
  Change them there, commit, apply — never in the dashboard, which the next apply
  overwrites.
- **Connect the repo last.** A service with a missing required variable exits at
  startup, so the first build fails. Declare the service without `source`, apply,
  set everything, then add the source and `--connect`. The script refuses to apply
  a declared source on an unconnected service without that flag.
- **Railway's certificate follows the first successful deploy** by a few minutes.
  Health checks against the custom domain fail until then; that is not a bug.
- **Do not install a CLI inside a service directory.** `bun add cf` in
  `inventory-api/` added a dependency that broke the image build once it was
  committed without its lockfile. Install tools globally.
- **Review `git diff --stat` before staging `package.json` files** for a release
  commit; stage version bumps only.

## After it is green

- `./infra/check.sh` passes, including the new tool's lines.
- One end-to-end action per integration the tool has: a file upload if it has a
  bucket, a notification if it pushes to `notify-api`.
- `infra/README.md` describes the tool's variables and anything unusual about it.
