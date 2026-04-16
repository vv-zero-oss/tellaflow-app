const { clipboard } = require('electron');

module.exports = {
  name: 'Clipboard',
  description: 'Read from and write to the system clipboard',
  tools: [
    {
      name: 'get_clipboard',
      description: 'Read the current text content of the clipboard.',
      parameters: {},
      execute() {
        const text = clipboard.readText();
        if (!text) return '(clipboard is empty)';
        if (text.length > 4000) return text.slice(0, 4000) + '\n[truncated]';
        return text;
      },
    },
    {
      name: 'set_clipboard',
      description: 'Write text to the clipboard.',
      parameters: {
        text: { type: 'string', description: 'Text to copy to clipboard' },
      },
      execute({ text }) {
        clipboard.writeText(text);
        return `Copied ${text.length} characters to clipboard`;
      },
    },
    {
      name: 'clear_clipboard',
      description: 'Clear the clipboard.',
      parameters: {},
      execute() {
        clipboard.clear();
        return 'Clipboard cleared';
      },
    },
  ],
};
