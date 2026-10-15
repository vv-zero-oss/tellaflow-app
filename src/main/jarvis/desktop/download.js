"use strict";
/**
 * One download, one archive extraction — what every tool Set up fetches goes
 * through (the speech and voice models, Peekaboo, Node's installer).
 *
 * Nothing partial is ever visible: a download lands under `<dest>.part` and is
 * renamed into place only once complete (and, when a digest is pinned,
 * verified). Every availability check here is a file-existence test, so a
 * truncated file at the real path would read as installed and fail later, at
 * first use, far from the cause.
 *
 * Archives are extracted with the platform's own `tar` (bsdtar on macOS, which
 * reads .tgz and .tar.bz2 alike): a decompressor dependency would be a larger
 * supply-chain surface than the thing it replaces.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.download = download;
exports.extract = extract;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:stream/promises");
async function download(url, dest, options = {}) {
    const part = `${dest}.part`;
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(dest), { recursive: true });
    node_fs_1.default.rmSync(part, { force: true });
    const response = await fetch(url, {
        redirect: "follow",
        signal: options.signal,
    });
    if (!response.ok || !response.body) {
        throw new Error(`${url} responded ${response.status}`);
    }
    const header = response.headers.get("content-length");
    const total = header && Number.isFinite(Number(header)) ? Number(header) : null;
    const hash = (0, node_crypto_1.createHash)("sha256");
    let seen = 0;
    const counter = new TransformStream({
        transform(chunk, controller) {
            seen += chunk.byteLength;
            hash.update(chunk);
            options.onProgress?.(seen, total);
            controller.enqueue(chunk);
        },
    });
    try {
        await (0, promises_1.pipeline)(
        // `pipeline` adapts a web ReadableStream through Readable.fromWeb.
        response.body.pipeThrough(counter), node_fs_1.default.createWriteStream(part), { signal: options.signal });
    }
    catch (err) {
        // A cancelled download leaves nothing behind to be mistaken for a start.
        node_fs_1.default.rmSync(part, { force: true });
        throw err;
    }
    if (options.sha256) {
        const actual = hash.digest("hex");
        if (actual !== options.sha256.toLowerCase()) {
            node_fs_1.default.rmSync(part, { force: true });
            throw new Error(`${node_path_1.default.basename(dest)} didn’t match its checksum — refusing to install it.`);
        }
    }
    node_fs_1.default.renameSync(part, dest);
}
/** Extract with the platform's own tar. */
function extract(archive, into) {
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)("tar", ["xf", archive, "-C", into], { shell: false });
        let stderr = "";
        child.stderr?.on("data", (d) => {
            stderr += d.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${stderr.trim().slice(-300)}`)));
    });
}
