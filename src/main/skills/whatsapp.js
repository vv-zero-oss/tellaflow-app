/**
 * whatsapp.js — WhatsApp skill
 *
 * Supports two modes:
 *  1. macOS native WhatsApp app (primary) — via osascript System Events
 *  2. WhatsApp Web (web.whatsapp.com) via Chrome extension — when available
 *
 * WhatsApp macOS uses Accessibility API for reading; Cmd+F to search contacts.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function osa(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
  return stdout.trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function openWhatsApp() {
  // Try native app first
  try {
    const running = await osa(
      'tell application "System Events" to get name of every process whose background only is false'
    );
    if (!running.includes('WhatsApp')) {
      await osa('tell application "WhatsApp" to activate');
      await sleep(2500);
    } else {
      await osa('tell application "WhatsApp" to activate');
      await sleep(800);
    }
    return 'native';
  } catch {
    // Native app not available — try web
    const wsBridge = require('../ws-bridge');
    if (wsBridge.isExtensionConnected()) {
      await wsBridge.sendToExtension('navigate', { url: 'https://web.whatsapp.com' });
      await sleep(3000);
      return 'web';
    }
    throw new Error('WhatsApp app not installed and Chrome extension not connected');
  }
}

async function whatsAppType(text) {
  await osa(`
    tell application "System Events"
      tell process "WhatsApp"
        keystroke "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
        delay 0.1
      end tell
    end tell`);
}

async function whatsAppKey(keyCode) {
  await osa(`
    tell application "System Events"
      tell process "WhatsApp"
        key code ${keyCode}
        delay 0.2
      end tell
    end tell`);
}

module.exports = {
  name: 'WhatsApp',
  description: 'Interact with the macOS WhatsApp app: open chats, send messages, read messages',
  tools: [

    {
      name: 'whatsapp_open_chat',
      description: 'Open a WhatsApp conversation with a contact by name or phone number',
      parameters: {
        contact: { type: 'string', description: 'Contact name or phone number' },
      },
      async execute({ contact }) {
        const mode = await openWhatsApp();
        if (mode === 'web') {
          // WhatsApp Web: search box
          const wsBridge = require('../ws-bridge');
          await wsBridge.sendToExtension('click', { selector: '[data-testid="chat-list-search"]' });
          await sleep(300);
          await wsBridge.sendToExtension('type', { selector: '[data-testid="chat-list-search"]', text: contact, delay: 30 });
          await sleep(800);
          await wsBridge.sendToExtension('press', { key: 'Enter' });
          return `Opened WhatsApp Web chat with ${contact}`;
        }
        // Native app — Cmd+F to search
        await osa(`
          tell application "System Events"
            tell process "WhatsApp"
              -- Focus the search field
              keystroke "f" using command down
              delay 0.5
              -- Clear and type contact
              keystroke "a" using command down
              delay 0.1
              keystroke "${contact.replace(/"/g, '\\"')}"
              delay 0.8
              key code 36
              delay 0.6
            end tell
          end tell`);
        return `Opened chat with ${contact} in WhatsApp`;
      },
    },

    {
      name: 'whatsapp_send_message',
      description: 'Send a message to a WhatsApp contact',
      parameters: {
        contact: { type: 'string', description: 'Contact name (opens the chat first if provided)' },
        message: { type: 'string', description: 'Message text to send' },
      },
      async execute({ contact, message }) {
        const mode = await openWhatsApp();
        if (contact) {
          // Open the chat first
          if (mode === 'web') {
            const wsBridge = require('../ws-bridge');
            await wsBridge.sendToExtension('click', { selector: '[data-testid="chat-list-search"]' });
            await sleep(300);
            await wsBridge.sendToExtension('type', { selector: '[data-testid="chat-list-search"]', text: contact, delay: 30 });
            await sleep(800);
            await wsBridge.sendToExtension('press', { key: 'Enter' });
            await sleep(600);
          } else {
            await osa(`
              tell application "System Events"
                tell process "WhatsApp"
                  keystroke "f" using command down
                  delay 0.4
                  keystroke "a" using command down
                  delay 0.1
                  keystroke "${contact.replace(/"/g, '\\"')}"
                  delay 0.8
                  key code 36
                  delay 0.6
                end tell
              end tell`);
          }
        }

        if (mode === 'web') {
          const wsBridge = require('../ws-bridge');
          await wsBridge.sendToExtension('click', { selector: '[data-testid="conversation-compose-box-input"], [contenteditable][data-tab="10"]' });
          await sleep(200);
          await wsBridge.sendToExtension('type', { selector: '[data-testid="conversation-compose-box-input"]', text: message, delay: 20 });
          await sleep(200);
          await wsBridge.sendToExtension('press', { key: 'Enter' });
        } else {
          // Type in native app — click the message input area (lower part of screen via Tab)
          await osa(`
            tell application "System Events"
              tell process "WhatsApp"
                -- Tab to message input
                key code 48
                delay 0.3
                keystroke "${message.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
                delay 0.2
                key code 36
                delay 0.3
              end tell
            end tell`);
        }
        return `Sent "${message.slice(0, 60)}" to ${contact || 'current chat'} on WhatsApp`;
      },
    },

    {
      name: 'whatsapp_read_messages',
      description: 'Read recent messages from the current WhatsApp conversation',
      parameters: {
        count:   { type: 'string', description: 'Number of messages to read (default 10)' },
        contact: { type: 'string', description: 'Optional contact to open first' },
      },
      async execute({ count = '10', contact }) {
        const wsBridge = require('../ws-bridge');
        if (!wsBridge.isExtensionConnected()) {
          return 'Reading WhatsApp messages requires Chrome extension with WhatsApp Web open. ' +
                 'Open web.whatsapp.com in Chrome with the Tellaflow extension.';
        }
        if (contact) {
          await wsBridge.sendToExtension('click', { selector: '[data-testid="chat-list-search"]' });
          await sleep(300);
          await wsBridge.sendToExtension('type', { selector: '[data-testid="chat-list-search"]', text: contact, delay: 30 });
          await sleep(800);
          await wsBridge.sendToExtension('press', { key: 'Enter' });
          await sleep(600);
        }
        const messages = await wsBridge.sendToExtension('read_messages', { limit: parseInt(count) || 10 });
        return messages || 'No messages found';
      },
    },

    {
      name: 'whatsapp_new_group',
      description: 'Create a new WhatsApp group (native app only)',
      parameters: {
        name: { type: 'string', description: 'Group name' },
      },
      async execute({ name }) {
        const mode = await openWhatsApp();
        if (mode !== 'native') return 'Creating groups is only supported in the native WhatsApp app';
        // Click the new chat / overflow menu
        await osa(`
          tell application "System Events"
            tell process "WhatsApp"
              -- Click the compose/new-chat icon (top left icon button)
              key code 48  -- Tab to reach new chat button
              delay 0.2
              key code 36
              delay 0.5
            end tell
          end tell`);
        return `Opened new group flow — enter contacts manually in WhatsApp`;
      },
    },

  ],
};
