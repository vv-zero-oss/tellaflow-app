"use strict";
/**
 * Peekaboo, fetched by Set up into the app's data folder — the same pinned,
 * checksummed npm tarball scripts/fetch-peekaboo.sh puts in a dev checkout
 * (a test holds the two to one version and digest).
 *
 * Unlike the script this does not thin the universal binary: `lipo` is an
 * Xcode tool, and on a Mac without the Command Line Tools its shim opens
 * Apple's "install developer tools" dialog. Left whole, the binary also keeps
 * its vendor signature, which thinning strips. It costs 36 MB of disk, not of
 * download.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PEEKABOO_PACKAGE = void 0;
exports.installPeekaboo = installPeekaboo;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const peekaboo_1 = require("./peekaboo");
const download_1 = require("./download");
exports.PEEKABOO_PACKAGE = {
    version: "4.2.0",
    sha256: "20b7a84bf6957bde20c228ff293cb9c9306671868eeaf3c10d0987c411601f00",
    url: "https://registry.npmjs.org/@steipete/peekaboo/-/peekaboo-4.2.0.tgz",
};
async function installPeekaboo(onProgress, signal) {
    const dest = (0, peekaboo_1.peekabooDownloadDir)();
    if (!dest)
        throw new Error("Peekaboo has nowhere to go yet.");
    const work = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "tellaflow-peekaboo-"));
    try {
        const tarball = node_path_1.default.join(work, "peekaboo.tgz");
        await (0, download_1.download)(exports.PEEKABOO_PACKAGE.url, tarball, { onProgress, sha256: exports.PEEKABOO_PACKAGE.sha256, signal });
        await (0, download_1.extract)(tarball, work);
        const source = node_path_1.default.join(work, "package");
        if (!node_fs_1.default.existsSync(node_path_1.default.join(source, "peekaboo")))
            throw new Error("The package has no peekaboo binary in it.");
        // Staged beside the destination and swapped in whole: a half-copied
        // folder must never pass the resolver's X_OK test.
        const staged = `${dest}.part`;
        node_fs_1.default.rmSync(staged, { recursive: true, force: true });
        node_fs_1.default.mkdirSync(staged, { recursive: true });
        for (const name of node_fs_1.default.readdirSync(source)) {
            // The Swift runtime shim is dlopen'd at launch: without it the binary
            // dies with a dyld error rather than a clean gate.
            if (name === "peekaboo" || name === "LICENSE" || name.endsWith(".dylib")) {
                node_fs_1.default.copyFileSync(node_path_1.default.join(source, name), node_path_1.default.join(staged, name));
            }
        }
        node_fs_1.default.chmodSync(node_path_1.default.join(staged, "peekaboo"), 0o755);
        node_fs_1.default.rmSync(dest, { recursive: true, force: true });
        node_fs_1.default.renameSync(staged, dest);
    }
    finally {
        node_fs_1.default.rmSync(work, { recursive: true, force: true });
    }
    // Verified by running it, the way the resolver will — and the resolver's
    // cached "not installed" is replaced in the same move.
    const info = await (0, peekaboo_1.resolvePeekaboo)(true);
    if (!info.ok)
        throw new Error(info.error ?? "Peekaboo didn’t start.");
}
