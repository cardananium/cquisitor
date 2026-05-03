# Contributing to CQUISITOR

Thanks for your interest in contributing! CQUISITOR is a CBOR/CDDL investigation tool for Cardano data, built on top of [`@cardananium/cquisitor-lib`](https://github.com/cardananium/cquisitor-lib).

## Getting started

```bash
bun install
bun run dev
```

The dev server runs at <http://localhost:3000>. Open the route you're working on:

- `/cardano-cbor` — Cardano-aware CBOR explorer
- `/general-cbor` — generic CBOR view + tx validation
- `/cddl-validator` — CDDL schema editor + CBOR-against-schema validation

## Tooling

- **Framework:** Next.js 16 (App Router, Turbopack), React 19, Tailwind v4.
- **Package manager:** [Bun](https://bun.sh).
- **Tests:** `bun test` (uses Bun's built-in runner).
- **Lint:** `bun run lint` (ESLint + `eslint-config-next`).
- **Typecheck:** `bunx tsc --noEmit`.
- **Production build:** `bun run build`.

Before opening a PR, please make sure all four pass locally:

```bash
bun test
bun run lint
bunx tsc --noEmit
bun run build
```

## Working with the underlying library

CBOR decoding, CDDL validation, and schema-aware diagnostics all live in the WASM library `@cardananium/cquisitor-lib`. The project pins a specific beta version in `package.json`. If you need a library change, open an issue or PR on [`cquisitor-lib`](https://github.com/cardananium/cquisitor-lib) first; once a new version is published, bump the dependency here.

## Code style

- Prefer editing existing files over creating new ones; reach for shared modules under `src/components/` and `src/utils/` before duplicating logic.
- Keep React components small. The shared `JsonTreeView` (`src/components/jsonTree/`) is the canonical example: a render-prop core with thin per-feature adapters.
- Don't write speculative comments. A short `WHY` comment is welcome where the constraint isn't obvious from the code.
- Tailwind v4 silently drops some class patterns from the bundle. When in doubt, use the `cq-` prefix that the rest of the codebase relies on.

## Pull requests

- Branch from `main`.
- Keep PRs focused. If you find unrelated cleanup along the way, please send it as a separate PR.
- For UI changes, include a screenshot or short clip in the PR description.
- A passing `bun run build` and clean lint output are required for review.

## Reporting bugs

Open an issue on <https://github.com/cardananium/cquisitor/issues> with:

- Steps to reproduce (or a CBOR hex / CDDL snippet that triggers the bug).
- What you expected vs. what you saw.
- Browser + OS, if the bug is visual.

Security-sensitive reports should follow [SECURITY.md](./SECURITY.md) instead.
