/**
 * discord.js — Discord skill
 *
 * Supports:
 *  1. Discord web (discord.com) via Chrome extension — preferred
 *  2. Native macOS Discord app via osascript System Events — fallback
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function osa(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
  return stdout.trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function openDiscord() {
  try {
    const running = await osa(
      'tell application "System Events" to get name of every process whose background only is false'
    );
    if (!running.includes('Discord')) {
      await osa('tell application "Discord" to activate');
      await sleep(3000);
    } else {
      await osa('tell application "Discord" to activate');
      await sleep(700);
    }
    return 'native';
  } catch {
    const wsBridge = require('../ws-bridge');
    if (wsBridge.isExtensionConnected()) {
      await wsBridge.sendToExtension('navigate', { url: 'https://discord.com/app' });
      await sleep(3000);
      return 'web';
    }
    throw new Error('Discord app not installed and Chrome extension not connected');
  }
}

async function extOrOsa(extFn, osaFn) {
  const wsBridge = require('../ws-bridge');
  if (wsBridge.isExtensionConnected()) {
    try { return await extFn(); } catch {}
  }
  return osaFn();
}

module.exports = {
  name: 'Discord',
  description: 'Interact with Discord: open servers, channels, send and read messages',
  tools: [

    {
      name: 'discord_open_server',
      description: 'Navigate to a Discord server by clicking its name in the sidebar',
      parameters: {
        server: { type: 'string', description: 'Server name (partial match works)' },
      },
      async execute({ server }) {
        return extOrOsa(
          async () => {
            const wsBridge = require('../ws-bridge');
            await wsBridge.sendToExtension('site_action', { action_name: 'discord_open_server', params: { server } });
            return `Navigated to server: ${server}`;
          },
          async () => {
            const mode = await openDiscord();
            // Use Ctrl+K (quick switcher) to navigate
            await osa(`
              tell application "System Events"
                tell process "Discord"
                  keystroke "k" using control down
                  delay 0.5
                  keystroke "${server.replace(/"/g, '\\"')}"
                  delay 0.7
                  key code 36
                  delay 0.5
                end tell
              end tell`);
            return `Navigated to Discord server: ${server} (${mode})`;
          }
        );
      },
    },

    {
      name: 'discord_open_channel',
      description: 'Open a specific text channel in the current Discord server',
      parameters: {
        channel: { type: 'string', description: 'Channel name without # (e.g. "general", "announcements")' },
        server:  { type: 'string', description: 'Optional server to navigate to first' },
      },
      async execute({ channel, server }) {
        return extOrOsa(
          async () => {
            const wsBridge = require('../ws-bridge');
            if (server) await wsBridge.sendToExtension('site_action', { action_name: 'discord_open_server', params: { server } });
            await wsBridge.sendToExtension('site_action', { action_name: 'discord_open_channel', params: { channel } });
            return `Opened #${channel} on Discord`;
          },
          async () => {
            const mode = await openDiscord();
            await osa(`
              tell application "System Events"
                tell process "Discord"
                  keystroke "k" using control down
                  delay 0.5
                  keystroke "${channel.replace(/"/g, '\\"')}"
                  delay 0.7
                  key code 36
                  delay 0.5
                end tell
              end tell`);
            return `Opened #${channel} in Discord (${mode})`;
          }
        );
      },
    },

    {
      name: 'discord_send_message',
      description: 'Send a message in the current Discord channel',
      parameters: {
        message: { type: 'string', description: 'Message text to send' },
        channel: { type: 'string', description: 'Optional channel to navigate to first' },
        server:  { type: 'string', description: 'Optional server to open first' },
      },
      async execute({ message, channel, server }) {
        return extOrOsa(
          async () => {
            const wsBridge = require('../ws-bridge');
            if (server)  await wsBridge.sendToExtension('site_action', { action_name: 'discord_open_server',  params: { server } });
            if (channel) await wsBridge.sendToExtension('site_action', { action_name: 'discord_open_channel', params: { channel } });
            await wsBridge.sendToExtension('site_action', { action_name: 'discord_send_message', params: { message } });
            return `Sent "${message.slice(0, 60)}" on Discord`;
          },
          async () => {
            await openDiscord();
            if (server) {
              await osa(`
                tell application "System Events"
                  tell process "Discord"
                    keystroke "k" using control down
                    delay 0.5
                    keystroke "${server.replace(/"/g, '\\"')}"
                    delay 0.7
                    key code 36
                    delay 0.5
                  end tell
                end tell`);
            }
            if (channel) {
              await osa(`
                tell application "System Events"
                  tell process "Discord"
                    keystroke "k" using control down
                    delay 0.5
                    keystroke "${channel.replace(/"/g, '\\"')}"
                    delay 0.7
                    key code 36
                    delay 0.5
                  end tell
                end tell`);
            }
            await osa(`
              tell application "System Events"
                tell process "Discord"
                  keystroke "${message.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
                  key code 36
                  delay 0.3
                end tell
              end tell`);
            return `Sent message on Discord`;
          }
        );
      },
    },

    {
      name: 'discord_read_messages',
      description: 'Read recent messages from the current Discord channel',
      parameters: {
        count:   { type: 'string', description: 'Number of messages to read (default 10)' },
        channel: { type: 'string', description: 'Optional channel to open first' },
      },
      async execute({ count = '10', channel }) {
        const wsBridge = require('../ws-bridge');
        if (!wsBridge.isExtensionConnected()) {
          return 'Reading Discord messages requires the Chrome extension with discord.com open';
        }
        if (channel) await wsBridge.sendToExtension('site_action', { action_name: 'discord_open_channel', params: { channel } });
        const messages = await wsBridge.sendToExtension('read_messages', { limit: parseInt(count) || 10 });
        return messages || 'No messages found';
      },
    },

  ],
};
