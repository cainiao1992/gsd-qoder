'use strict';

/**
 * plugin.cjs — Qoder Plugin artifact builder.
 *
 * Produces the artifact set for a self-contained Qoder Plugin directory
 * (.qoder-plugin/plugin.json, agents/, skills/, hooks/, gsd-core/). Reuses
 * the text conversion and hook-script projection from projection.cjs; adds
 * the plugin manifest, wrapped hooks.json with ${QODER_PLUGIN_ROOT} paths,
 * and bundles the gsd-core runtime directory so skill/agent references
 * resolve within the plugin root.
 */
const fs = require('node:fs');
const path = require('node:path');

const projection = require('./projection.cjs');

const EXCLUDED_HOOK_COMMANDS = /gsd-check-update/;
const TEXT_EXTENSIONS = new Set(['.md', '.cjs', '.js', '.json', '.sh', '.txt', '.yaml', '.yml']);

/**
 * Replace config-dir gsd-core path references with ${QODER_PLUGIN_ROOT}/gsd-core/
 * so that skills/agents resolve references within the plugin directory.
 * Applied after projection.cjs has already converted .claude → .qoder.
 */
function convertToPluginPaths(content) {
  return content
    .replace(/~\/\.qoder(?:-cn)?\/gsd-core\//g, '${QODER_PLUGIN_ROOT}/gsd-core/')
    .replace(/\.\/\.qoder(?:-cn)?\/gsd-core\//g, '${QODER_PLUGIN_ROOT}/gsd-core/')
    .replace(/\.qoder(?:-cn)?\/gsd-core\//g, '${QODER_PLUGIN_ROOT}/gsd-core/');
}

/**
 * Build the .qoder-plugin/plugin.json manifest artifact.
 * @param {{ version: string }} opts
 * @returns {{ relativePath: string, content: string }}
 */
function buildPluginJson({ version }) {
  const manifest = {
    name: 'gsd-qoder',
    version,
    description: 'GSD spec-driven development system for Qoder — agents, skills, and hooks.',
    author: { name: 'Xiangfang Chen' },
    homepage: 'https://github.com/cainiao1992/gsd-qoder',
    repository: 'https://github.com/cainiao1992/gsd-qoder',
    license: 'Apache-2.0',
    keywords: ['gsd', 'spec-driven-development', 'planning', 'workflow'],
  };
  return {
    relativePath: '.qoder-plugin/plugin.json',
    content: JSON.stringify(manifest, null, 2) + '\n',
  };
}

/**
 * Build the wrapped hooks/hooks.json artifact for plugin consumption.
 * Keeps the { "hooks": {...} } wrapper required by the plugin spec and
 * replaces ${CLAUDE_PLUGIN_ROOT} with ${QODER_PLUGIN_ROOT}.
 * @param {{ coreRoot: string }} opts
 * @returns {{ relativePath: string, content: string }}
 */
function buildPluginHooksJson({ coreRoot }) {
  const hooksJsonPath = path.join(coreRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksJsonPath)) {
    return { relativePath: 'hooks/hooks.json', content: '{ "hooks": {} }\n' };
  }
  const raw = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  const sourceHooks = raw.hooks || {};
  const result = {};

  for (const [event, groups] of Object.entries(sourceHooks)) {
    const filtered = [];
    for (const group of groups) {
      const hooks = (group.hooks || []).filter(
        (h) => !EXCLUDED_HOOK_COMMANDS.test(h.command || '')
      );
      if (hooks.length === 0) continue;
      const entry = {
        hooks: hooks.map((h) => ({
          ...h,
          command: h.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '${QODER_PLUGIN_ROOT}'),
        })),
      };
      if (group.matcher) entry.matcher = group.matcher;
      filtered.push(entry);
    }
    if (filtered.length > 0) result[event] = filtered;
  }

  const output = { ...raw, hooks: result };
  return {
    relativePath: 'hooks/hooks.json',
    content: JSON.stringify(output, null, 2) + '\n',
  };
}

/**
 * Recursively bundle the gsd-core/ runtime directory (references, workflows,
 * bin, contexts, templates) into plugin artifacts. All text files receive the
 * full Claude → Qoder conversion — this is intentional: source files contain
 * runtime-read references like ${CLAUDE_CONFIG_DIR:-$HOME/.claude} that MUST
 * become QODER_CONFIG_DIR / .qoder for the projected plugin to resolve the
 * correct config dir at runtime. Non-text files are skipped to avoid
 * corrupting future binary resources.
 * @param {{ coreRoot: string }} opts
 * @returns {Array<{ relativePath: string, content: string }>}
 */
function buildGsdCoreArtifacts({ coreRoot }) {
  const gsdCoreDir = path.join(coreRoot, 'gsd-core');
  if (!fs.existsSync(gsdCoreDir)) return [];
  const artifacts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const raw = fs.readFileSync(full, 'utf8');
      const content = convertToPluginPaths(
        projection.convertClaudeToQoderMarkdown(raw)
      );
      artifacts.push({
        relativePath: path.join('gsd-core', path.relative(gsdCoreDir, full)),
        content,
      });
    }
  };
  walk(gsdCoreDir);
  return artifacts;
}

/**
 * Build the complete artifact list for a Qoder Plugin directory.
 * @param {{ coreRoot: string, version: string }} opts
 * @returns {Array<{ relativePath: string, content: string }>}
 */
function buildPluginArtifacts({ coreRoot, version }) {
  const projected = projection.buildProjectedArtifacts({ coreRoot });
  const withPluginPaths = projected.map((art) => ({
    relativePath: art.relativePath,
    content: convertToPluginPaths(art.content),
  }));
  return [
    buildPluginJson({ version }),
    ...withPluginPaths,
    ...projection.buildHookArtifacts({ coreRoot }),
    buildPluginHooksJson({ coreRoot }),
    ...buildGsdCoreArtifacts({ coreRoot }),
  ];
}

module.exports = Object.freeze({
  buildPluginJson,
  buildPluginHooksJson,
  buildGsdCoreArtifacts,
  buildPluginArtifacts,
  convertToPluginPaths,
});
