// bb's frame in Tellaflow's theme: only the shared tokens, only safe values,
// and the same list the Assistant page reads.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { THEME_TOKENS, isSafeTokenValue, themeCss, buildBbChromeScript } from '../../src/main/jarvis/bb/bb-chrome.js';

describe('bb theme sheet', () => {
  it('maps the app tokens onto bb, its background onto the card it sits in', () => {
    const css = themeCss({ background: '#111', card: 'oklch(0.178 0 0)', foreground: 'oklch(0.985 0 0)', radius: '0.75rem' });
    expect(css).toContain('--background: oklch(0.178 0 0) !important;');
    expect(css).toContain('--canvas: oklch(0.178 0 0) !important;');
    expect(css).toContain('--ink: oklch(0.985 0 0) !important;');
    expect(css).toContain('--radius: 0.75rem !important;');
    expect(css).toMatch(/^html:root, html:root\.dark \{/);
  });

  it('never writes a value that could close the rule', () => {
    for (const bad of ['red; } body { display:none', 'url("x")', '</style>', 'a\\62 c', '']) {
      expect(isSafeTokenValue(bad)).toBe(false);
    }
    expect(themeCss({ foreground: 'red; } * { display: none' })).not.toContain('display: none');
    expect(themeCss({ 'evil-token': '#fff' })).not.toContain('evil-token');
  });

  it('sets bb’s own theme setting so its next load starts in the right mode', () => {
    const script = buildBbChromeScript({ theme: 'dark', tokens: { card: '#222' } });
    expect(script).toContain('"bb.theme"');
    expect(script).toContain('var theme = "dark"');
    expect(() => new Function(script)).not.toThrow();
  });

  it('reads the same token list in the renderer as main accepts', () => {
    const ipc = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/src/lib/ipc.ts'), 'utf8');
    const list = /THEME_TOKENS_FOR_BB = \[([\s\S]*?)\] as const/.exec(ipc)[1].match(/'([^']+)'/g).map((t) => t.slice(1, -1));
    expect(list).toEqual(THEME_TOKENS);
  });
});
