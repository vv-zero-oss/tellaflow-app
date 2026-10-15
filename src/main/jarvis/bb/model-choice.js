"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.READ_MODEL_CHOICE_SCRIPT = void 0;
exports.parseModelChoice = parseModelChoice;
exports.createModelChoiceStore = createModelChoiceStore;
exports.executionAttempts = executionAttempts;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
/** bb's own set (`reasoningLevelSchema`). A value outside it would have bb
 *  refuse the whole thread, so anything else is dropped rather than sent. */
const REASONING_LEVELS = [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "ultracode",
    "max",
    "ultra",
];
/**
 * Runs inside bb's document. The key shapes are bb's composer's own
 * (`bb.promptbox.provider`, then `bb.promptbox.model-<provider>-1` and
 * `bb.promptbox.reasoning-<provider>-1`, the provider URI-encoded), read in
 * bb 0.42.1's `workspace-checkout-display` chunk. The bb version is pinned
 * (`BB_APP_VERSION`), so these move only when the pin does.
 *
 * An empty provider key means nobody has picked one, and that answers `null`
 * rather than falling back to anything: the composer is then showing bb's
 * default too, and naming nothing keeps the two agreeing.
 */
exports.READ_MODEL_CHOICE_SCRIPT = `(() => {
  try {
    const providerId = (localStorage.getItem("bb.promptbox.provider") || "").trim();
    if (!providerId) return null;
    const key = encodeURIComponent(providerId);
    return {
      providerId,
      model: localStorage.getItem("bb.promptbox.model-" + key + "-1") || "",
      reasoningLevel: localStorage.getItem("bb.promptbox.reasoning-" + key + "-1") || "",
    };
  } catch (err) {
    return null;
  }
})()`;
/** What bb's document (or the mirror file) answered, as a choice or nothing. */
function parseModelChoice(value) {
    if (typeof value !== "object" || value === null)
        return null;
    const entry = value;
    const providerId = typeof entry.providerId === "string" ? entry.providerId.trim() : "";
    if (!providerId)
        return null;
    const choice = { providerId };
    const model = typeof entry.model === "string" ? entry.model.trim() : "";
    if (model)
        choice.model = model;
    const reasoning = entry.reasoningLevel;
    if (typeof reasoning === "string" && REASONING_LEVELS.includes(reasoning)) {
        choice.reasoningLevel = reasoning;
    }
    return choice;
}
function createModelChoiceStore(deps) {
    const take = async () => {
        let reading;
        try {
            reading = await deps.read();
        }
        catch {
            reading = "unreachable";
        }
        if (reading !== "unreachable")
            writeMirror(deps.file, reading);
        return reading;
    };
    return {
        async current() {
            const reading = await take();
            return reading === "unreachable" ? readMirror(deps.file) : reading;
        },
        async refresh() {
            await take();
        },
    };
}
function readMirror(file) {
    try {
        return parseModelChoice(JSON.parse(fs.readFileSync(file, "utf-8")));
    }
    catch {
        // Missing before the first reading, or unreadable: bb's default, which is
        // what the editor did before it remembered anything.
        return null;
    }
}
function writeMirror(file, choice) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(choice ?? {}, null, 2));
    }
    catch {
        // A read-only userData costs only the reading from before a relaunch.
    }
}
/** Providers to try when nobody has picked one in bb's composer — the
 *  assistant CLIs people most often have signed in, in that order. */
const PREFERRED_PROVIDERS = ["claude-code", "codex"];
/**
 * The executions to try, in order, for a thread the editor starts on its own:
 * the model the person last picked in bb's composer; else a provider this
 * machine really has signed in; else bb's own default (`null`). The middle
 * step is not decoration — on a fresh profile there is no pick, and bb's
 * default was Codex on a machine that only had Claude Code, so every thread
 * failed with a 503 about Codex models. A caller tries each until one is not
 * refused.
 */
async function executionAttempts(client, pick, reasoningLevel) {
    const attempts = [];
    if (pick)
        attempts.push({ ...pick, reasoningLevel });
    else {
        const ready = await client.readyProviders().catch(() => []);
        const ordered = [...PREFERRED_PROVIDERS.filter((p) => ready.includes(p)), ...ready.filter((p) => !PREFERRED_PROVIDERS.includes(p))];
        if (ordered[0])
            attempts.push({ providerId: ordered[0], reasoningLevel });
    }
    attempts.push(null);
    return attempts;
}
