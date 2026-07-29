# GSD for Qoder

![Release](https://img.shields.io/github/v/release/cainiao1992/gsd-qoder)

`gsd-qoder` is an Embeddable Orchestration System (EoS) that projects [GSD](https://github.com/open-gsd/gsd-core) — the spec-driven development system — into Qoder CLI (Alibaba's `@qoder-ai/qodercli`). It is registered in the GSD EoS Registry and built against the GSD Host-Integration Interface. Running `gsd-qoder install` takes GSD's source agents and skills and projects them into `~/.qoder/` (or `QODER_CONFIG_DIR`), making GSD's spec-driven workflows — spec authoring, planning, task decomposition, code review — directly available inside Qoder CLI.

## Install

```bash
npm install --global github:cainiao1992/gsd-qoder
gsd-qoder install
```

Running `gsd-qoder install` interactively prompts you to choose a Qoder edition:

```
  Select your Qoder edition:
    1) Qoder International (qoder.com)   → ~/.qoder
    2) Qoder China (qoder.cn)            → ~/.qoder-cn

  Enter choice [1]:
```

- **Qoder International** (qoder.com) installs to `~/.qoder`
- **Qoder China** (qoder.cn) installs to `~/.qoder-cn`

Both editions are the same product; the only difference is the config directory. To skip the prompt, pass `--root` or set `QODER_CONFIG_DIR`:

```bash
# Explicit directory
gsd-qoder install --root ~/.qoder-cn

# Or via env var
QODER_CONFIG_DIR=~/.qoder-cn gsd-qoder install
```

In non-interactive environments (CI, pipes), the International edition (`~/.qoder`) is used by default.

To remove every file this package projected (tracked via the install manifest):

```bash
gsd-qoder uninstall
```

## Commands

| Command | Description |
|---|---|
| `gsd-qoder install` | Project GSD agents + skills into the Qoder config directory and write the install manifest. |
| `gsd-qoder uninstall` | Remove every file recorded in the manifest; leaves anything GSD didn't project untouched. |
| `gsd-qoder descriptor` | Print the EoS descriptor (the 9 host-integration axis values) as JSON, for the GSD EoS Registry. |
| `gsd-qoder doctor` | Diagnose the local install: verify gsd-core is present, check projected file counts, flag missing or stale files. |

## Axis provenance

Each of the 9 GSD host-integration axes, the negotiated value, and the Qoder documentation that value was derived from.

| Axis | Value | Source | Evidence |
|---|---|---|---|
| embeddingMode | declarative | https://docs.qoder.com/en/cli/skills | SKILL.md files with YAML frontmatter, discovered from `~/.qoder/skills/<name>/SKILL.md` |
| commandSurface | slash-file | https://docs.qoder.com/en/cli/command | Slash commands authored as markdown files with YAML frontmatter (`/gsd-*` style) |
| dispatch.subagentToolkit | full | https://docs.qoder.com/en/cli/subagent | "Omitted means use the current available tool set; `*` means all tools" |
| dispatch.isolation | none | https://docs.qoder.com/en/cli/subagent | Worktree is a frontmatter-declared, per-agent-definition property — not a dispatch-time parameter. GSD's harness/orchestrator models both assume a per-dispatch injection point Qoder doesn't expose; activating it needs the converter to inject `isolation: worktree` at install time (follow-up) |
| dispatch.maxDepth | undocumented | https://docs.qoder.com/en/cli/subagent | Nesting is tool-availability-driven ("Yes, if the `Agent` tool remains available"); no numeric depth cap documented |
| modelMode | passive | https://docs.qoder.com/en/cli/sdk/references | SDK is an AsyncGenerator consumed via `for await`; the host owns the conversation loop |
| hookBus | host | https://docs.qoder.com/en/cli/hooks | "Hooks let you intercept the Agent's main execution flow at key points in Qoder CLI" |
| transport | mcp | https://docs.qoder.com/en/cli/mcp-servers | MCP is built-in (`qodercli mcp add`); transports: stdio / sse / http / ws |
| runtime | node | https://www.npmjs.com/package/@qoder-ai/qodercli | Ships as the npm package `@qoder-ai/qodercli`; Node.js 18+ |
| effortSurface | argv | https://docs.qoder.com/en/cli/model | `--reasoning-effort` startup flag (levels: low / medium / high / xhigh / max); `/effort` TUI command |

## Sources consulted

- https://docs.qoder.com/en/cli/quick-start
- https://docs.qoder.com/en/cli/using-cli
- https://docs.qoder.com/en/cli/command
- https://docs.qoder.com/en/cli/skills
- https://docs.qoder.com/en/cli/model
- https://docs.qoder.com/en/cli/hooks
- https://docs.qoder.com/en/cli/subagent
- https://docs.qoder.com/en/cli/mcp-servers
- https://www.npmjs.com/package/@qoder-ai/qodercli
- https://docs.qoder.com/en/cli/sdk/references

## Known limitations

- **Hooks/settings.json wiring is deferred** — this first release projects agents + skills only. The 8-event settings.json hooks block (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStart, SubagentStop, PreCompact, FileChanged) will follow once the settings-merge logic is implemented.
- **dispatch.isolation: none** — Qoder documents a real worktree capability (`isolation: worktree` frontmatter), but it's a declaration-time, per-agent-definition property, not a dispatch-time parameter. GSD's two negotiation models (harness-worktree, orchestrator-worktree) both assume a per-dispatch injection point Qoder doesn't expose. Activating worktree isolation needs the converter to inject `isolation: worktree` into the executor agent's frontmatter — tracked as a follow-up.

## How it works

1. Depends on `@opengsd/gsd-core` (installed automatically as a regular npm dependency).
2. Reads GSD's source agents/skills from the gsd-core package.
3. Applies Qoder-specific conversions (path rewrites, frontmatter sanitization, branding).
4. Writes projected files to `~/.qoder/agents/` and `~/.qoder/skills/`.
5. Tracks installed files in `.gsd-qoder-manifest.json` for clean uninstall.

## License

Apache-2.0, matching `@qoder-ai/qodercli`'s license.
