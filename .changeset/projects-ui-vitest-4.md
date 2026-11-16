---
"@operai/projects-ui": patch
---

Align `vitest` to 4 (`^4.1.12`, as the other frontends), closing the two critical `tinypool` and the `vitest` / `@vitest/mocker` advisories that vitest 3 pulled in. Tests and tooling only; the app bundle is unchanged. `tsconfig.app.json` now declares the `node` types explicitly (vitest 3 used to bring them in transitively).
