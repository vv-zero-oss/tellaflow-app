// Ported from canvas (bb-model-choice.test.ts) with the code it tests; paths and names adjusted.
import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BbApiError, BbClient, type BbClient as BbClientType, type BbHttpRequestInit } from "../../../src/main/jarvis/bb/client"
import {
  createModelChoiceStore,
  parseModelChoice,
  READ_MODEL_CHOICE_SCRIPT,
  type ModelChoiceReading,
} from "../../../src/main/jarvis/bb/model-choice"
import { sendToWorkspace, setProjectMapFactory, startWorkspaceThread } from "../../../src/main/jarvis/bb/workspace-url"

const CLAUDE = { providerId: "claude-code", model: "claude-fable-5-1", reasoningLevel: "high" as const }

let mirror: string
beforeEach(() => {
  mirror = path.join(mkdtempSync(path.join(tmpdir(), "model-choice-")), "agent-model-choice.json")
  setProjectMapFactory(null)
})

/** bb's composer storage, as a page would hold it, with the script run over it. */
function readFrom(storage: Record<string, string>): unknown {
  const localStorage = { getItem: (key: string) => storage[key] ?? null }
  return new Function("localStorage", `return ${READ_MODEL_CHOICE_SCRIPT}`)(localStorage)
}

describe("reading bb's composer", () => {
  it("reads the provider, and that provider's model and reasoning", () => {
    // The keys bb 0.42.1 writes; the model and reasoning are per provider, so
    // the Codex ones sitting beside them must not leak into a Claude pick.
    const reading = readFrom({
      "bb.promptbox.provider": "claude-code",
      "bb.promptbox.model-claude-code-1": "claude-fable-5-1",
      "bb.promptbox.reasoning-claude-code-1": "high",
      "bb.promptbox.model-codex-1": "gpt-5.5",
      "bb.promptbox.reasoning-codex-1": "low",
    })
    expect(parseModelChoice(reading)).toEqual(CLAUDE)
  })

  it("answers nothing when nobody has picked, so bb's default stands", () => {
    expect(parseModelChoice(readFrom({}))).toBeNull()
    expect(parseModelChoice(readFrom({ "bb.promptbox.model-codex-1": "gpt-5.5" }))).toBeNull()
  })

  it("leaves the model to the provider when the pick is its default", () => {
    expect(
      parseModelChoice(readFrom({ "bb.promptbox.provider": "claude-code", "bb.promptbox.model-claude-code-1": "" }))
    ).toEqual({ providerId: "claude-code" })
  })

  it("drops a reasoning level bb would refuse the whole thread over", () => {
    expect(parseModelChoice({ providerId: "codex", reasoningLevel: "extreme" })).toEqual({
      providerId: "codex",
    })
  })
})

describe("the remembered choice", () => {
  it("takes what the composer shows, and mirrors it", async () => {
    const store = createModelChoiceStore({ file: mirror, read: async () => CLAUDE })
    expect(await store.current()).toEqual(CLAUDE)
    expect(JSON.parse(readFileSync(mirror, "utf-8"))).toEqual(CLAUDE)
  })

  it("falls back to the last reading when no panel is open to ask", async () => {
    // The moment right after a relaunch: a request from the board, before the
    // Agent panel has been opened in this session.
    writeFileSync(mirror, JSON.stringify(CLAUDE))
    const store = createModelChoiceStore({ file: mirror, read: async () => "unreachable" })
    expect(await store.current()).toEqual(CLAUDE)
  })

  it("believes a composer that says nothing is picked over an older mirror", async () => {
    writeFileSync(mirror, JSON.stringify(CLAUDE))
    const store = createModelChoiceStore({ file: mirror, read: async () => null })
    expect(await store.current()).toBeNull()
  })

  it("follows a change of mind", async () => {
    let shown: ModelChoiceReading = { providerId: "codex" }
    const store = createModelChoiceStore({ file: mirror, read: async () => shown })
    await store.refresh()
    shown = CLAUDE
    await store.refresh()
    shown = "unreachable"
    expect(await store.current()).toEqual(CLAUDE)
  })
})

describe("the request bb is sent", () => {
  it("names the provider, model and reasoning when there is a pick", async () => {
    const bodies: unknown[] = []
    const fetchImpl = async (_url: string, init?: BbHttpRequestInit) => {
      bodies.push(init?.body ? JSON.parse(init.body) : undefined)
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: "thr_1", title: null, createdAt: 1 }) }
    }
    const client = new BbClient({ port: 38886, fetchImpl })
    const environment = { type: "host" as const, hostId: "h", workspace: { type: "unmanaged" as const, path: "/p" } }
    await client.createThread({ projectId: "proj_1", input: [], environment, execution: CLAUDE })
    await client.createThread({ projectId: "proj_1", input: [], environment })
    expect(bodies[0]).toMatchObject({ providerId: "claude-code", model: "claude-fable-5-1", reasoningLevel: "high" })
    expect(bodies[1]).not.toHaveProperty("providerId")
    expect(bodies[1]).not.toHaveProperty("model")
  })
})

/** A bb with one project for /work/site, recording each thread it is asked for. */
function fakeServer(options: { refuse?: (args: Record<string, unknown>) => boolean } = {}) {
  const created: Array<Record<string, unknown>> = []
  const client = {
    origin: "http://127.0.0.1:38886",
    hosts: async () => [{ id: "host-1", name: "this mac", status: "connected" }],
    projects: async () => [{ id: "proj_1", name: "site", sources: [{ hostId: "host-1", path: "/work/site" }] }],
    listThreads: async () => [],
    async createThread(args: Record<string, unknown>) {
      created.push(args)
      if (options.refuse?.(args)) {
        throw new BbApiError({ status: 409, message: "provider_unavailable", url: "/threads" })
      }
      return { id: `thr_${created.length}`, title: null, createdAt: created.length }
    },
  } as unknown as BbClientType
  const ensureServer = async () =>
    ({ client, serverPort: 38886, daemonPort: 38887, dataDir: "/d", hostId: "host-1", spawned: true }) as never
  return { created, ensureServer }
}

describe("conversations the editor starts", () => {
  it("run on the model last picked, from the board and from a first message", async () => {
    // The bug: both of these went to bb with no provider named, and bb gave
    // them its first ready one — Codex — whatever the composer said.
    const { created, ensureServer } = fakeServer()
    const modelChoice = async () => CLAUDE
    await startWorkspaceThread("/work/site", "make three variations", { ensureServer, modelChoice })
    await sendToWorkspace("/work/site", "hello", { ensureServer, modelChoice })
    expect(created).toHaveLength(2)
    for (const args of created) expect(args.execution).toEqual(CLAUDE)
  })

  it("leave the choice to bb when nothing has been picked", async () => {
    const { created, ensureServer } = fakeServer()
    await startWorkspaceThread("/work/site", "go", { ensureServer, modelChoice: async () => null })
    expect(created[0].execution).toBeUndefined()
  })

  it("still run when bb will not take the pick", async () => {
    // A provider logged out of since it was picked: the request runs on bb's
    // default rather than failing in front of somebody on the board.
    const { created, ensureServer } = fakeServer({ refuse: (args) => Boolean(args.execution) })
    const answer = await startWorkspaceThread("/work/site", "go", {
      ensureServer,
      modelChoice: async () => CLAUDE,
    })
    expect(created.map((args) => Boolean(args.execution))).toEqual([true, false])
    expect(answer.threadId).toBe("thr_2")
  })
})
