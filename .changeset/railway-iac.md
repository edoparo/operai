---
---

Railway configuration moves from per-service railway.json (Config as Code) to .railway/railway.ts (ADR-0088). No runtime change: same Dockerfile build, start, healthcheck, pre-deploy migrations, replicas and EU region.
