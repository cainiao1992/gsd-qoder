'use strict';

/**
 * gsd-qoder — artifact projection module.
 *
 * Reads GSD's source agents (<coreRoot>/agents/gsd-NAME.md) and skills
 * (<coreRoot>/skills/gsd-NAME/SKILL.md) from the installed @opengsd/gsd-core,
 * applies Qoder-specific conversions (Claude → Qoder), and returns an array of
 * { relativePath, content } artifacts ready for the declarative adapter to write
 * under ~/.qoder/.
 *
 * Conversions are ported verbatim from the round-17 reviewed descriptor — do not
 * tweak the regexes without re-running the projection golden suite.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Rewrite a Claude-flavoured markdown body for Qoder.
 * Order matters: slash forms are replaced before bare forms so compound tokens
 * (e.g. `.claude/foo`) are not left half-rewritten.
 */
function convertClaudeToQoderMarkdown(content) {
  let converted = content;
  // Hyphen-normalise /gsd:<commandName> → /gsd-<commandName>
  converted = converted.replace(/\/gsd:([a-z0-9-]+)/gi, (_, commandName) => `/gsd-${commandName}`);
  // Slash forms first (most specific)
  converted = converted.replace(/\.claude\/skills\//g, '.qoder/skills/');
  converted = converted.replace(/\.\/\.claude\//g, './.qoder/');
  converted = converted.replace(/\.claude\//g, '.qoder/');
  // Bare forms (no trailing slash) — after slash forms. Negative lookahead preserves compound tokens
  converted = converted.replace(/\.\/\.claude(?![\w-])/g, './.qoder');
  converted = converted.replace(/~\/\.claude(?![\w-])/g, '~/.qoder');
  converted = converted.replace(/\$HOME\/\.claude(?![\w-])/g, '$HOME/.qoder');
  // Env var name rewrite
  converted = converted.replace(/\bCLAUDE_CONFIG_DIR\b/g, 'QODER_CONFIG_DIR');
  // CLAUDE.md → AGENTS.md
  converted = converted.replace(/`\.\/CLAUDE\.md`/g, '`AGENTS.md`');
  converted = converted.replace(/\.\/CLAUDE\.md/g, 'AGENTS.md');
  converted = converted.replace(/`CLAUDE\.md`/g, '`AGENTS.md`');
  converted = converted.replace(/\bCLAUDE\.md\b/g, 'AGENTS.md');
  // Branding
  converted = converted.replace(/\bClaude Code\b/g, 'Qoder');
  return converted;
}

/** Split a markdown file into { fmRaw, body }; fmRaw is the YAML between the fences. */
function splitFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { fmRaw: '', body: content };
  return { fmRaw: match[1], body: match[2] };
}

/** Extract the raw (quote-preserving) value of a top-level `field:` line. */
function extractField(fmRaw, fieldName) {
  const re = new RegExp(`^${fieldName}:[ \\t]*(.*)$`, 'm');
  const match = re.exec(fmRaw);
  return match ? match[1].trim() : '';
}

/**
 * Project a single agent: sanitise frontmatter to exactly name + description
 * (regression fix — Qoder rejects tools/color/hooks), then convert the body.
 */
function projectAgent(content) {
  const { fmRaw, body } = splitFrontmatter(content);
  const name = extractField(fmRaw, 'name');
  const description = extractField(fmRaw, 'description');
  const sanitizedFm = `---\nname: ${name}\ndescription: ${description}\n---`;
  const convertedBody = convertClaudeToQoderMarkdown(body.replace(/^\r?\n+/, ''));
  return { relativePath: `agents/${name}.md`, content: `${sanitizedFm}\n\n${convertedBody}` };
}

/**
 * Project a single skill: convert the entire file (frontmatter + body).
 * Existing name/description are preserved as-is.
 */
function projectSkill(name, content) {
  return { relativePath: `skills/${name}/SKILL.md`, content: convertClaudeToQoderMarkdown(content) };
}

/**
 * Iterate coreRoot's agents and skills, project each, and return a deterministic
 * array of { relativePath, content } artifacts.
 */
function buildProjectedArtifacts({ coreRoot }) {
  const artifacts = [];
  const agentsDir = path.join(coreRoot, 'agents');
  const skillsDir = path.join(coreRoot, 'skills');

  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir).sort()) {
      if (!entry.startsWith('gsd-') || !entry.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(agentsDir, entry), 'utf8');
      artifacts.push(projectAgent(content));
    }
  }

  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir).sort()) {
      if (!entry.startsWith('gsd-')) continue;
      const skillFile = path.join(skillsDir, entry, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf8');
      artifacts.push(projectSkill(entry, content));
    }
  }

  return artifacts;
}

// ── Hook projection ────────────────────────────────────────────────────────

/**
 * Hook scripts that are self-contained (Node built-ins only). Excludes
 * gsd-check-update.js / gsd-check-update-worker.js which require() internal
 * gsd-core modules via relative paths that break outside the package tree.
 */
const HOOK_FILES = [
  'gsd-config-reload.js',
  'gsd-context-monitor.js',
  'gsd-ensure-canonical-path.js',
  'gsd-prompt-guard.js',
  'gsd-read-guard.js',
  'gsd-read-injection-scanner.js',
  'gsd-worktree-path-guard.js',
];

/** Commands referencing hooks we cannot ship (external deps). */
const EXCLUDED_HOOK_COMMANDS = /gsd-check-update/;

/**
 * Return hook script files as { relativePath, content } artifacts.
 * Only includes self-contained hooks (see HOOK_FILES).
 */
function buildHookArtifacts({ coreRoot }) {
  const hooksDir = path.join(coreRoot, 'hooks');
  const artifacts = [];
  for (const file of HOOK_FILES) {
    const filePath = path.join(hooksDir, file);
    if (!fs.existsSync(filePath)) continue;
    artifacts.push({
      relativePath: `hooks/${file}`,
      content: fs.readFileSync(filePath, 'utf8'),
    });
  }
  return artifacts;
}

/**
 * Build the hooks config object for settings.json.
 * Reads gsd-core's hooks.json, removes entries with unresolvable deps,
 * and replaces ${CLAUDE_PLUGIN_ROOT} with the actual target root path.
 * @returns {object} e.g. { PreToolUse: [...], PostToolUse: [...], ... }
 */
function buildHooksConfig({ coreRoot, targetRoot }) {
  const hooksJsonPath = path.join(coreRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksJsonPath)) return {};
  const raw = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  const sourceHooks = raw.hooks || {};
  const config = {};

  for (const [event, groups] of Object.entries(sourceHooks)) {
    const filtered = [];
    for (const group of groups) {
      const hooks = (group.hooks || []).filter(
        (h) => !EXCLUDED_HOOK_COMMANDS.test(h.command || '')
      );
      if (hooks.length === 0) continue;
      const entry = { hooks: hooks.map((h) => ({ ...h, command: h.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, targetRoot) })) };
      if (group.matcher) entry.matcher = group.matcher;
      filtered.push(entry);
    }
    if (filtered.length > 0) config[event] = filtered;
  }
  return config;
}

module.exports = Object.freeze({
  convertClaudeToQoderMarkdown,
  splitFrontmatter,
  extractField,
  projectAgent,
  projectSkill,
  buildProjectedArtifacts,
  buildHookArtifacts,
  buildHooksConfig,
  HOOK_FILES,
});
