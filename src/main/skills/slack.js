/**
 * slack.js — Slack skill
 *
 * Two modes:
 *  1. Web app (app.slack.com) via Chrome extension — preferred when extension connected
 *  2. Native macOS Slack app via osascript System Events — fallback
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function osa(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
  return stdout.trim();
}

async function ext(action, params = {}) {
  const wsBridge = require('../ws-bridge');
  if (!wsBridge.isExtensionConnected()) throw new Error('Chrome extension not connected');
  return wsBridge.sendToExtension(action, params);
}

async function extOrOsa(webFn, osaFn) {
  const wsBridge = require('../ws-bridge');
  if (wsBridge.isExtensionConnected()) return webFn();
  return osaFn();
}

/** Open Slack (native app or web) */
async function openSlack() {
  try {
    await osa(`tell application "Slack" to activate`);
    await new Promise(r => setTimeout(r, 1500));
    return 'native';
  } catch {
    // Slack not installed as native app — open web
    const browser = require('./browser');
    const openUrl = browser.tools.find(t => t.name === 'open_url');
    if (openUrl) await openUrl.execute({ url: 'https://app.slack.com' });
    return 'web';
  }
}

module.exports = {
  name: 'Slack',
  description: 'Interact with Slack: open DMs, channels, send messages, read messages, search',
  tools: [

    {
      name: 'slack_open_dm',
      description: 'Open a direct message conversation with a person in Slack by name',
      parameters: {
        name:    { type: 'string', description: 'Person\'s name or @username' },
        message: { type: 'string', description: 'Optional first message to send after opening the DM' },
      },
      async execute({ name, message }) {
        return extOrOsa(
          async () => {
            await ext('site_action', { action_name: 'slack_open_dm', params: { name } });
            if (message) await ext('site_action', { action_name: 'slack_send_message', params: { message } });
            return `Opened DM with ${name}${message ? ' and sent message' : ''}`;
          },
          async () => {
            const mode = await openSlack();
            await osa(`
              tell application "System Events"
                tell process "Slack"
                  keystroke "k" using command down
                  delay 0.5
                  keystroke "${name.replace(/"/g, '\\"')}"
                  delay 0.8
                  key code 36
                  delay 0.5
                end tell
              end tell`);
            if (message) {
              await osa(`
                tell application "System Events"
                  tell process "Slack"
                    keystroke "${message.replace(/"/g, '\\"')}"
                    key code 36
                    delay 0.3
                  end tell
                end tell`);
            }
            return `Opened DM with ${name} in Slack (${mode})`;
          }
        );
      },
    },

    {
      name: 'slack_open_channel',
      description: 'Navigate to a Slack channel by name (e.g. "general", "engineering")',
      parameters: {
        channel: { type: 'string', description: 'Channel name without # (e.g. "general")' },
      },
      async execute({ channel }) {
        return extOrOsa(
          async () => {
            await ext('site_action', { action_name: 'slack_open_channel', params: { channel } });
            return `Navigated to #${channel}`;
          },
          async () => {
            await openSlack();
            const ch = channel.replace(/^#/, '');
            await osa(`
              tell application "System Events"
                tell process "Slack"
                  keystroke "k" using command down
                  delay 0.5
                  keystroke "#${ch.replace(/"/g, '\\"')}"
                  delay 0.8
                  key code 36
                  delay 0.5
                end tell
              end tell`);
            return `Navigated to #${ch} in Slack`;
          }
        );
      },
    },

    {
      name: 'slack_send_message',
      description: 'Send a message in the currently active Slack channel or DM',
      parameters: {
        message:  { type: 'string', description: 'Message text to send' },
        channel:  { type: 'string', description: 'Optional channel to open first (e.g. "general")' },
        person:   { type: 'string', description: 'Optional person name to open DM first' },
      },
      async execute({ message, channel, person }) {
        return extOrOsa(
          async () => {
            if (channel) await ext('site_action', { action_name: 'slack_open_channel', params: { channel } });
            if (person)  await ext('site_action', { action_name: 'slack_open_dm',      params: { name: person } });
            await ext('site_action', { action_name: 'slack_send_message', params: { message } });
            return `Sent "${message.slice(0, 60)}" on Slack`;
          },
          async () => {
            await openSlack();
            if (channel) {
              const ch = channel.replace(/^#/, '');
              await osa(`
                tell application "System Events"
                  tell process "Slack"
                    keystroke "k" using command down
                    delay 0.4
                    keystroke "#${ch.replace(/"/g, '\\"')}"
                    delay 0.7
                    key code 36
                    delay 0.5
                  end tell
                end tell`);
            }
            await osa(`
              tell application "System Events"
                tell process "Slack"
                  keystroke "${message.replace(/"/g, '\\"')}"
                  key code 36
                  delay 0.3
                end tell
              end tell`);
            return `Sent "${message.slice(0, 60)}" on Slack`;
          }
        );
      },
    },

    {
      name: 'slack_read_messages',
      description: 'Read the last N messages in the current Slack channel or DM',
      parameters: {
        count:   { type: 'string', description: 'Number of messages to read (default: 10)' },
        channel: { type: 'string', description: 'Optional channel to navigate to first' },
      },
      async execute({ count = '10', channel }) {
        const wsBridge = require('../ws-bridge');
        if (wsBridge.isExtensionConnected()) {
          if (channel) await ext('site_action', { action_name: 'slack_open_channel', params: { channel } });
          const messages = await ext('read_messages', { limit: parseInt(count) || 10 });
          return messages || 'No messages found';
        }
        return `Please open Slack in Chrome with the extension installed to read messages`;
      },
    },

    {
      name: 'slack_search',
      description: 'Search Slack for messages, people, or files',
      parameters: {
        query: { type: 'string', description: 'Search query, e.g. "from:john meeting notes"' },
      },
      async execute({ query }) {
        return extOrOsa(
          async () => {
            await ext('site_action', { action_name: 'slack_search', params: { query } });
            return `Searched Slack for "${query}"`;
          },
          async () => {
            await openSlack();
            await osa(`
              tell application "System Events"
                tell process "Slack"
                  keystroke "f" using {command down, shift down}
                  delay 0.5
                  keystroke "${query.replace(/"/g, '\\"')}"
                  key code 36
                  delay 0.5
                end tell
              end tell`);
            return `Searched Slack for "${query}"`;
          }
        );
      },
    },

  ],
};
