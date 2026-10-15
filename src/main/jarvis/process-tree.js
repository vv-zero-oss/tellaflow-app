"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.descendantsOf = descendantsOf;
exports.readProcessTable = readProcessTable;
exports.killProcessTree = killProcessTree;
const node_child_process_1 = require("node:child_process");
/**
 * Killing a process and everything it started, for the one case where asking
 * nicely failed: a child the app launched that did not exit on SIGTERM.
 *
 * Not a process group kill: bb's launcher is started in the app's own group
 * (so a Ctrl+C on `npm run dev` still reaches it), which a group kill would
 * take down with it. The tree is read from `ps` instead — the launcher, its
 * server and its host daemon are parent and children, and a SIGKILL to the
 * launcher alone would leave the other two orphaned and holding their ports.
 */
/** Every pid below `root` in a `pid ppid` table, deepest last. */
function descendantsOf(table, root) {
    const children = new Map();
    for (const [pid, ppid] of table) {
        if (pid === ppid)
            continue;
        const list = children.get(ppid) ?? [];
        list.push(pid);
        children.set(ppid, list);
    }
    const out = [];
    const seen = new Set([root]);
    const queue = [root];
    while (queue.length) {
        const next = queue.shift();
        for (const child of children.get(next) ?? []) {
            if (seen.has(child))
                continue;
            seen.add(child);
            out.push(child);
            queue.push(child);
        }
    }
    return out;
}
/** `ps -A -o pid=,ppid=` parsed; empty where there is no `ps` (Windows). */
function readProcessTable() {
    try {
        const text = (0, node_child_process_1.execFileSync)("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 2_000 });
        const rows = [];
        for (const line of text.split("\n")) {
            const [pid, ppid] = line.trim().split(/\s+/).map(Number);
            if (Number.isInteger(pid) && Number.isInteger(ppid))
                rows.push([pid, ppid]);
        }
        return rows;
    }
    catch {
        return [];
    }
}
/** SIGKILL `root` and every process under it. The tree is read before the
 *  first signal: a parent killed first reparents its children to init, and
 *  they would no longer be found under it. */
function killProcessTree(root, deps = {}) {
    const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
    const pids = [root, ...descendantsOf((deps.table ?? readProcessTable)(), root)];
    for (const pid of pids) {
        try {
            kill(pid, "SIGKILL");
        }
        catch {
            // Already gone.
        }
    }
    return pids;
}
