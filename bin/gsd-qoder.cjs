#!/usr/bin/env node
'use strict';

/**
 * gsd-qoder — EoS CLI entry point.
 *
 * Projects GSD agents + skills into Qoder's config dir (~/.qoder), records
 * installed files in a manifest so uninstall is deterministic and updates are
 * hash-protected. Modelled on tchivs/gsd-omp's bin/gsd-omp.cjs.
 * Commands: install, uninstall, descriptor, doctor. No external deps.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const eos = require('../src/eos.cjs'); // initialize, resolveCoreRoot
const projection = require('../src/projection.cjs'); // buildProjectedArtifacts

/** Build the descriptor object from the EoS context. */
function descriptorOf(ctx) {
  return {
    id: 'gsd-qoder',
    protocolVersion: ctx.negotiation.protocolVersion,
    profile: ctx.profile,
    interfacePoints: ['command', 'dispatch', 'model', 'hooks', 'state', 'artifact'],
    axes: ctx.axes,
  };
}

// ── ANSI helpers ────────────────────────────────────────────────────────────
const C = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };
const OK = `${C.green}✓${C.reset}`;
const WARN = `${C.yellow}⚠${C.reset}`;
const FAIL = `${C.red}✗${C.reset}`;

const MANIFEST_NAME = '.gsd-qoder-manifest.json';

// ── Argument parsing ────────────────────────────────────────────────────────

/** Parse argv into { command, root, force }. Unknown flags ignored. */
function parseArgs(argv) {
  let command = null;
  let root = null;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '-r') root = argv[++i] || null;
    else if (a.startsWith('--root=')) root = a.slice('--root='.length);
    else if (a === '--force') force = true;
    else if (!a.startsWith('-') && command === null) command = a;
  }
  return { command, root, force };
}

/** Resolve target dir: --root > QODER_CONFIG_DIR > ~/.qoder (~ expanded). */
function resolveRoot(rootFlag) {
  const from = rootFlag || process.env.QODER_CONFIG_DIR || path.join(os.homedir(), '.qoder');
  return path.resolve(from.replace(/^~/, os.homedir()));
}

// ── Crypto + IO helpers ─────────────────────────────────────────────────────

/** SHA-256 hex of a UTF-8 string. */
function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Atomic write: temp sibling + rename (crash-safe on POSIX/NTFS). Makes dirs. */
function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── Manifest helpers ────────────────────────────────────────────────────────

/** Read manifest { files: [{ path, sha256 }] }, or null if absent/unparseable. */
function readManifest(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_NAME), 'utf8'));
    return { files: Array.isArray(parsed.files) ? parsed.files : [] };
  } catch {
    return null;
  }
}

/** Write manifest atomically. */
function writeManifest(root, entries) {
  atomicWrite(path.join(root, MANIFEST_NAME), JSON.stringify({ files: entries }, null, 2) + '\n');
}

// ── Commands ────────────────────────────────────────────────────────────────

/** install — handshake, project, atomic-write, manifest. Refuses user-modified files without --force. */
async function cmdInstall({ root, force }) {
  console.log(`${C.cyan}gsd-qoder install${C.reset} → ${root}`);

  const ctx = eos.initialize();
  const desc = descriptorOf(ctx);
  console.log(`${OK} Handshake: protocol v${desc.protocolVersion} (core: ${ctx.coreRoot})`);

  const artifacts = projection.buildProjectedArtifacts({ coreRoot: ctx.coreRoot });
  const prev = readManifest(root);
  const prevHash = prev ? new Map(prev.files.map((f) => [f.path, f.sha256])) : new Map();

  const entries = [];
  for (const art of artifacts) {
    const target = path.join(root, art.relativePath);
    const newHash = sha256(art.content);
    const oldHash = prevHash.get(target);
    // User-modified = file exists on disk and its current hash differs from
    // what the manifest recorded. (Comparing projection vs. manifest would
    // never flag anything — both come from the same projection output.)
    let userModified = false;
    if (oldHash !== undefined && fs.existsSync(target)) {
      userModified = sha256(fs.readFileSync(target, 'utf8')) !== oldHash;
    }
    if (userModified) {
      if (!force) {
        console.error(`${FAIL} Modified by user, refusing to overwrite: ${art.relativePath}`);
        console.error(`    Re-run with --force to clobber.`);
        return 1;
      }
      console.log(`${WARN} Clobbering user-modified file (--force): ${art.relativePath}`);
    }
    atomicWrite(target, art.content);
    entries.push({ path: target, sha256: newHash });
  }

  const agentCount = artifacts.filter((a) => a.relativePath.startsWith('agents/')).length;
  const skillCount = artifacts.filter((a) => a.relativePath.startsWith('skills/')).length;
  if (agentCount) console.log(`${OK} Projected ${agentCount} agent${agentCount === 1 ? '' : 's'}`);
  if (skillCount) console.log(`${OK} Projected ${skillCount} skill${skillCount === 1 ? '' : 's'}`);

  writeManifest(root, entries);
  console.log(`${OK} Manifest written (${entries.length} file${entries.length === 1 ? '' : 's'})`);

  // TODO(hooks): wire ~/.qoder/settings.json hooks block here. Full set is 8
  // events — PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStart,
  // SubagentStop, PreCompact, FileChanged — but settings.json merging
  // (preserve user hooks, dedupe ours) is deferred. First version projects
  // agents + skills only.
  console.log(`${WARN} Hooks/settings.json wiring not yet implemented (agents+skills only)`);
  console.log(`${OK} Done.`);
  return 0;
}

/** uninstall — delete every tracked file (missing is fine) then the manifest. */
function cmdUninstall({ root }) {
  console.log(`${C.cyan}gsd-qoder uninstall${C.reset} → ${root}`);
  const manifest = readManifest(root);
  if (!manifest || manifest.files.length === 0) {
    console.log(`${WARN} No manifest found — nothing to uninstall.`);
    return 0;
  }
  let removed = 0;
  for (const entry of manifest.files) {
    try {
      fs.unlinkSync(entry.path);
      removed++;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  try {
    fs.unlinkSync(path.join(root, MANIFEST_NAME));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  console.log(`${OK} Removed ${removed} file${removed === 1 ? '' : 's'} + manifest.`);
  return 0;
}

/** descriptor — print the EoS descriptor as JSON. */
function cmdDescriptor() {
  const ctx = eos.initialize();
  process.stdout.write(JSON.stringify(descriptorOf(ctx), null, 2) + '\n');
  return 0;
}

/** doctor — gsd-core present + protocol >= 1. */
function cmdDoctor() {
  console.log(`${C.cyan}gsd-qoder doctor${C.reset}`);
  let coreRoot;
  try {
    coreRoot = eos.resolveCoreRoot();
  } catch (err) {
    console.error(`${FAIL} gsd-core not found: ${err.message}`);
    console.error(`    Install @opengsd/gsd-core first.`);
    return 1;
  }
  console.log(`${OK} gsd-core present: ${coreRoot}`);

  let ctx;
  try {
    ctx = eos.initialize();
  } catch (err) {
    console.error(`${FAIL} Handshake failed: ${err.message}`);
    return 1;
  }
  const proto = ctx.negotiation.protocolVersion;
  if (proto < 1) {
    console.error(`${FAIL} Protocol version ${proto} < 1 — upgrade gsd-core.`);
    return 1;
  }
  console.log(`${OK} Protocol v${proto}, profile "${ctx.profile}"`);
  console.log(`${OK} Healthy.`);
  return 0;
}

// ── Usage + dispatch ────────────────────────────────────────────────────────

function printUsage() {
  console.log(`gsd-qoder — GSD integration for the Qoder CLI.

Usage:
  gsd-qoder install [--root <dir>] [--force]
  gsd-qoder uninstall [--root <dir>]
  gsd-qoder descriptor
  gsd-qoder doctor

Options:
  --root <dir>   Qoder config dir (default ~/.qoder, or $QODER_CONFIG_DIR).
  --force        Overwrite files modified since the last install.

Environment:
  QODER_CONFIG_DIR   Overrides the default config dir (e.g. ~/.qoder-cn).`);
}

/** Entry point: parse argv, dispatch, exit with the command's code. */
async function main() {
  const { command, root, force } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'install': return cmdInstall({ root: resolveRoot(root), force });
    case 'uninstall': return cmdUninstall({ root: resolveRoot(root) });
    case 'descriptor': return cmdDescriptor();
    case 'doctor': return cmdDoctor();
    default:
      printUsage();
      return command === null ? 0 : 2;
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((err) => {
      console.error(`${FAIL} ${err && err.stack ? err.stack : err}`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs, resolveRoot, sha256, atomicWrite, readManifest, writeManifest, main,
};
