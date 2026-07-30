# AGENTS.md — gsd-qoder

Guidance for any AI coding agent working in this repo. Read this before editing.

## What this is

`gsd-qoder` is a GSD **Embeddable Orchestration System (EoS)** package. It is *not* an application — it is a thin CLI that projects GSD's source agents + skills (from the `@opengsd/gsd-core` npm dependency) into a Qoder config directory (`~/.qoder` or `~/.qoder-cn`), which is shared by both the Qoder CLI and Qoder Desktop clients of the same region. Claude → Qoder conversions are applied along the way. It is registered in the GSD EoS Registry and built against the GSD Host-Integration Interface.

Three source files, all CommonJS (`.cjs`), zero runtime dependencies, Node 18+.

## Layout

```
bin/gsd-qoder.cjs   — CLI entry point: install / uninstall / descriptor / doctor
src/eos.cjs         — host-integration handshake; declares Qoder's 9 axes, loads gsd-core SDK
src/projection.cjs  — reads gsd-core agents/skills, applies conversions, emits { relativePath, content } artifacts
README.md           — user docs + authoritative § Axis provenance (cites docs.qoder.com)
node_modules/@opengsd/gsd-core/ — source read by projection (agents/, skills/); never edit, it's a dependency
```

## Commands

```bash
npm run lint      # node --check on all 3 source files — run before every commit
npm test          # node --test (no tracked tests yet; add *.test.cjs next to the module under test)
                   # bin/gsd-qoder.cjs exports parseArgs, resolveRoot, sha256, atomicWrite,
                   # readManifest, writeManifest, main — pure helpers, NOT frozen (unlike src/*).
npm run prepack   # lint + test
./bin/gsd-qoder.cjs doctor                       # verify gsd-core present + protocol ≥ 1
./bin/gsd-qoder.cjs install --root /tmp/qtest --force   # install into a throwaway dir for testing
```

No build step. Always `npm run lint` after touching a `.cjs` file.

## Architecture boundaries (do not cross)

- **`bin/` is the only layer that touches the filesystem and the user.** It writes files, prints, parses argv, reads stdin, owns the manifest. `src/` must stay pure and side-effect-free so it stays unit-testable.
- **`src/eos.cjs`** owns the handshake and the 9 `QODER_AXES`. Axis values are negotiated against `@opengsd/gsd-core`'s compiled SDK; every value must trace to a cited Qoder doc (see README § Axis provenance). Do not invent axis values. `initialize()` hard-asserts the negotiated profile is `declarative-cli` — if an axis edit drifts the profile, `install` and `doctor` throw at runtime.
- **`src/projection.cjs`** owns all Claude → Qoder text conversion. The conversion regexes are ported verbatim from a reviewed descriptor — **do not tweak them without re-running the projection golden suite** (there isn't one yet; treat current output as the golden baseline). Order matters: slash forms are replaced before bare forms.
- Agent frontmatter is sanitized to **only** `name` + `description` (Qoder rejects `tools`/`color`/`hooks`). Skill frontmatter is converted as-is.

## Conventions

- **CommonJS only.** Use `require` / `module.exports`; `.cjs` extensions are mandatory (no `"type": "module"`).
- **No runtime deps.** Node built-ins only (`node:fs`, `node:path`, `node:os`, `node:crypto`, `node:readline/promises`). Adding a dependency is a design change — raise it first.
- **Freeze exports:** `module.exports = Object.freeze({ ... })` for `src/*.cjs`; top-level axis objects are `Object.freeze`-d.
- Atomic writes via `atomicWrite` (temp sibling + rename) — never raw `fs.writeFileSync` to a final path.
- User-modified files are hash-protected; never overwrite without `--force` (see `cmdInstall`).
- Every source file starts with `'use strict';` and a header comment describing purpose + any provenance constraint.

## Install / edition behavior

`install` / `uninstall` resolve the target dir in priority order: `--root` flag → `QODER_CONFIG_DIR` env → interactive TTY prompt (International `~/.qoder` / China `~/.qoder-cn`) → non-TTY default `~/.qoder`. Keep this priority when editing `resolveRoot`.

## Known deferred work

- **Hooks / `settings.json` wiring is NOT implemented** — only agents + skills are projected. The 8-event hooks block needs settings-merge logic; see the `TODO(hooks)` comment in `cmdInstall`.
- **`dispatch.isolation` is `none`** — Qoder supports `isolation: worktree` as a declaration-time frontmatter property, but GSD expects a dispatch-time injection point. Activating it requires injecting frontmatter at install time (follow-up).

Before changing sensitive areas (axes, conversions, manifest format), read README.md fully — it is the source of truth for documented behavior.
