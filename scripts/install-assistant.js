#!/usr/bin/env node
/**
 * Install the assistant's runtime (Node + bb) the way Settings › Assistant ›
 * Download does, from a plain Node — for a dev checkout or an e2e run.
 *
 *   node scripts/install-assistant.js <dir>
 *
 * Then point the app at it: TELLAFLOW_ASSISTANT_RUNTIME_DIR=<dir>.
 */
const path = require('path');
const { installRuntime, runtimeStatus } = require('../src/main/jarvis/runtime');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'resources', 'assistant-runtime-install'));
const status = runtimeStatus(dir);
if (status.state === 'installed') {
  console.log(`Assistant runtime already installed at ${dir} (Node ${status.installed.node}, bb ${status.installed.bb})`);
  process.exit(0);
}
let last = '';
installRuntime({
  dir,
  onProgress: ({ phase, received, total }) => {
    const line = phase === 'node' && total ? `node ${Math.round((received / total) * 100)}%` : phase;
    if (line !== last) { last = line; console.log(`  ${line}`); }
  },
}).then((s) => {
  console.log(`Assistant runtime installed at ${dir} (Node ${s.installed.node}, bb ${s.installed.bb})`);
}, (err) => {
  console.error(`Install failed: ${err.message}`);
  process.exit(1);
});
