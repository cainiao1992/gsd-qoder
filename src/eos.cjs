'use strict';

/**
 * gsd-qoder — EoS core module.
 *
 * Declares Qoder's host-integration axes (sourced from docs.qoder.com/en/cli/),
 * runs the GSD host-integration handshake against the installed @opengsd/gsd-core, and
 * exposes the declarative adapter that install/uninstall consume.
 *
 * Every axis value traces to a cited Qoder CLI doc — see README § Axis provenance.
 */

const path = require('node:path');

// Qoder's nine negotiated axes — verbatim from the round-17 descriptor
// (capabilities/qoder/capability.json), each value documented at docs.qoder.com.
const QODER_AXES = Object.freeze({
  embeddingMode: 'declarative',
  commandSurface: 'slash-file',
  dispatch: Object.freeze({
    namedDispatch: true,
    nested: true,
    maxDepth: 'undocumented',
    background: true,
    subagentToolkit: 'full',
    backgroundDispatch: true,
    isolation: 'none',
  }),
  modelMode: 'passive',
  hookBus: 'host',
  stateIO: 'filesystem',
  transport: 'mcp',
  runtime: 'node',
  effortSurface: 'argv',
});

let cached;

/** Resolve the installed @opengsd/gsd-core root directory. */
function resolveCoreRoot() {
  return path.dirname(require.resolve('@opengsd/gsd-core/package.json'));
}

/** Load the Host-Integration SDK from gsd-core's compiled lib. */
function loadSdk(coreRoot = resolveCoreRoot()) {
  return require(path.join(coreRoot, 'gsd-core', 'bin', 'lib', 'host-integration-sdk.cjs'));
}

/** Initialise the EoS: handshake, negotiate, freeze adapters. Cached. */
function initialize() {
  if (cached) return cached;
  const coreRoot = resolveCoreRoot();
  const SDK = loadSdk(coreRoot);
  const request = SDK.buildHandshakeRequest({
    protocolVersion: SDK.PROTOCOL_VERSION,
    axes: QODER_AXES,
  });
  const negotiation = SDK.handleHandshakeRequest(request);
  const profile = SDK.profileOf(negotiation.effective);
  if (profile !== 'declarative-cli') {
    throw new Error(`gsd-qoder: expected declarative-cli profile, got ${JSON.stringify(profile)}`);
  }
  if (negotiation.protocolVersion < 1) {
    throw new Error(`gsd-qoder: unsupported protocol version ${JSON.stringify(negotiation.protocolVersion)}`);
  }

  cached = Object.freeze({
    SDK,
    coreRoot,
    cliPath: path.join(coreRoot, 'gsd-core', 'bin', 'gsd-tools.cjs'),
    axes: QODER_AXES,
    request,
    negotiation,
    profile,
    adapter: SDK.createDeclarativeAdapter({ runtime: 'qoder' }),
  });
  return cached;
}

module.exports = Object.freeze({ QODER_AXES, resolveCoreRoot, loadSdk, initialize });
