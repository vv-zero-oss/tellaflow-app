/**
 * Tellaflow's half of the island bridge (`resources/bb-plugin-tellaflow`).
 *
 * The plugin gives every agent in our bb two tools — `tellaflow_say` and
 * `tellaflow_ask` — and queues what they say. This module puts the plugin into
 * bb (a path install, idempotent), long-polls its event route on bb's loopback
 * port, hands each event to the assistant, and posts the user's answer to a
 * question back. So a chat the assistant started reports its result ON THE
 * ISLAND, and can ask the user something there and carry on, instead of
 * finishing in a window nobody was watching.
 *
 * The poll is a loop of `GET …/events?after=<seq>&wait=25000`: an answer at
 * once when there is news, a quiet reconnect every 25 s when there is not. A
 * plugin restart (bb's, or our reload after an app update) begins its seq
 * again; the route says `reset` and we resume from its number.
 *
 * Electron-free; the client, clock and sleep are injected.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ID = 'tellaflow';
const POLL_WAIT_MS = 25_000;
const RETRY_MS = [1000, 2000, 5000, 10_000];

/** The plugin's folder: next to the app's other resources once packaged
 *  (electron-builder `extraResources`, a real folder plain-Node bb can read),
 *  the repo's `resources/` in development. */
function bridgePluginDir(resourcesPath = process.resourcesPath) {
  const packaged = resourcesPath ? path.join(resourcesPath, 'bb-plugin-tellaflow') : null;
  if (packaged && fs.existsSync(path.join(packaged, 'package.json'))) return packaged;
  return path.join(__dirname, '..', '..', '..', '..', 'resources', 'bb-plugin-tellaflow');
}

function pluginVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; } catch { return null; }
}

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.client      the bb client (ensureServer().client)
 * @param {(event: object) => void} deps.onEvent   a `say` / `ask` / `ask-closed` from an agent
 * @param {string} [deps.pluginDir]
 * @param {typeof fetch} [deps.fetch]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {(msg: string, data?: unknown) => void} [deps.log]
 */
function createIslandBridge(deps) {
  const dir = deps.pluginDir ?? bridgePluginDir();
  const doFetch = deps.fetch ?? ((...a) => fetch(...a));
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => {});
  /** Clients the plugin is installed into (one per bb server we talked to). */
  const installed = new WeakMap();
  let running = false;
  let after = 0;
  let generation = 0;

  const base = (client) => `${client.baseUrl}/plugins/${PLUGIN_ID}/http`;

  /** Install (or re-point) the plugin, and reload it when the copy bb runs is
   *  not the copy this app ships — bb reads a path plugin once, at load. */
  async function ensure(client) {
    if (!client) return false;
    const known = installed.get(client);
    if (known) return known;
    const job = (async () => {
      try {
        await client.installPlugin(`path:${dir}`);
      } catch (err) {
        // Already registered from this folder is fine; anything else is logged
        // and the assistant carries on without the bridge.
        if (!/already|exists|registered/i.test(String(err?.message || err))) {
          log('island bridge: install failed', String(err?.message || err));
          return false;
        }
      }
      const want = pluginVersion(dir);
      try {
        const health = await (await doFetch(`${base(client)}/health`)).json();
        if (want && health?.version !== want) {
          await client.reloadPlugin(PLUGIN_ID);
          log('island bridge: reloaded plugin', { from: health?.version ?? null, to: want });
        }
      } catch {
        await client.reloadPlugin(PLUGIN_ID).catch(() => {});
      }
      return true;
    })();
    installed.set(client, job);
    const ok = await job;
    if (!ok) installed.delete(client);
    return ok;
  }

  async function pollLoop(gen) {
    let failures = 0;
    while (running && gen === generation) {
      try {
        const client = await deps.client();
        await ensure(client);
        const res = await doFetch(`${base(client)}/events?after=${after}&wait=${POLL_WAIT_MS}`);
        if (!res.ok) throw new Error(`events ${res.status}`);
        const body = await res.json();
        if (!running || gen !== generation) return;
        failures = 0;
        const rows = Array.isArray(body?.events) ? body.events : [];
        // A reset (the plugin restarted) replays what it holds; anything older
        // than the reset is gone, which is the honest outcome.
        for (const ev of rows) {
          if (!body.reset && ev.seq <= after) continue;
          try { deps.onEvent(ev); } catch (err) { log('island bridge: handler threw', String(err?.message || err)); }
        }
        after = typeof body?.seq === 'number' ? body.seq : after;
      } catch (err) {
        if (!running || gen !== generation) return;
        const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
        if (failures === 0) log('island bridge: poll failed, retrying', String(err?.message || err));
        failures++;
        await sleep(wait);
      }
    }
  }

  /** Start listening. Safe to call more than once. */
  function start() {
    if (running) return;
    running = true;
    void pollLoop(++generation);
  }

  function stop() {
    running = false;
    generation++;
  }

  /** The user's answer to an agent's `tellaflow_ask` (null: no answer). */
  async function answer(id, text) {
    try {
      const client = await deps.client();
      const res = await doFetch(`${base(client)}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, answer: text ?? null }),
      });
      return res.ok;
    } catch (err) {
      log('island bridge: answer failed', String(err?.message || err));
      return false;
    }
  }

  return { ensure, start, stop, answer, isRunning: () => running };
}

module.exports = { PLUGIN_ID, bridgePluginDir, createIslandBridge };
