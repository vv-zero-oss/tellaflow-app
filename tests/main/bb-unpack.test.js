// bb (the assistant's backend) runs under plain Node from app.asar.unpacked,
// so every package it can load must be unpacked too — a missing one is a
// packaged app whose assistant never starts, while every dev run works.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function closure() {
  const seen = new Set();
  const resolveDir = (name, from) => {
    for (let d = from; ; d = path.dirname(d)) {
      const c = path.join(d, 'node_modules', name);
      if (fs.existsSync(path.join(c, 'package.json'))) return c;
      if (path.dirname(d) === d) return null;
    }
  };
  const walk = (dir) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const n of Object.keys({ ...pj.dependencies, ...pj.optionalDependencies })) {
      const r = resolveDir(n, dir);
      if (r) walk(r);
    }
  };
  walk(path.join(root, 'node_modules', 'bb-app'));
  return [...seen]
    .map((d) => path.relative(path.join(root, 'node_modules'), d))
    .filter((d) => !d.startsWith('..') && !d.includes(`${path.sep}node_modules${path.sep}`))
    .map((d) => d.split(path.sep).slice(0, d.startsWith('@') ? 2 : 1).join('/'));
}

describe('electron-builder asarUnpack covers bb', () => {
  const yml = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  const m = /node_modules\/\{([^}]+)\}\/\*\*\/\*/.exec(yml);
  it.skipIf(!fs.existsSync(path.join(root, 'node_modules', 'bb-app')))('lists every package bb-app loads', () => {
    expect(m).toBeTruthy();
    const patterns = m[1].split(',').map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
    const missing = closure().filter((name) => !patterns.some((re) => re.test(name)));
    expect(missing).toEqual([]);
  });
});
