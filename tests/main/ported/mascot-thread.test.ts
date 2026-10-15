// Ported from canvas (mascot-thread.test.ts) with the code it tests; paths and names adjusted.
import { describe, expect, it } from "vitest"
import type { BbClient, BbThreadEvent } from "../../../src/main/jarvis/bb/client"
import {
  createMascotThreads,
  questionFromInteraction,
  MASCOT_REASONING_LEVEL,
  type MascotBrainEvent,
} from "../../../src/main/jarvis/bb/mascot-thread"

/**
 * A scripted bb: each thread has an event log; `send` / `create` append the
 * events a turn produces, optionally after some wakes so a stop can land in the
 * middle of a reply.
 */
function fakeBb(
  script: (text: string, seqStart: number) => Array<Omit<BbThreadEvent, "seq">>,
  gate?: Promise<void>
) {
  const logs = new Map<string, BbThreadEvent[]>()
  const status = new Map<string, string>()
  const calls: string[] = []
  const sent: Array<{ threadId: string; text: string; mode?: string; reasoningLevel?: string }> = []
  const created: Array<Record<string, unknown>> = []
  let nextId = 0
  const append = (threadId: string, text: string) => {
    const log = logs.get(threadId)!
    for (const e of script(text, log.length)) log.push({ ...e, seq: log.length + 1 })
    status.set(threadId, "idle")
  }
  const client = {
    async createThread(args: Record<string, unknown>) {
      if (client.refuse?.(args)) throw new Error("503 Unable to load models")
      created.push(args)
      const id = `thr_${++nextId}`
      logs.set(id, [])
      calls.push(`create ${id}`)
      append(id, (args.input as Array<{ text: string }>)[0].text)
      return { id, title: null, createdAt: 0 }
    },
    async sendMessage(threadId: string, input: Array<{ text: string }>, options: { mode?: string; reasoningLevel?: string } = {}) {
      calls.push(`send ${threadId}`)
      sent.push({ threadId, text: input[0].text, ...options })
      append(threadId, input[0].text)
    },
    readyList: ["claude-code"] as string[],
    refuse: null as null | ((args: Record<string, unknown>) => boolean),
    async readyProviders() {
      return client.readyList
    },
    async threadStatus(threadId: string) {
      return status.get(threadId) ?? null
    },
    async latestEventSeq(threadId: string) {
      return logs.get(threadId)!.length
    },
    async waitForEvent() {
      // Holds the reader mid-turn when a test needs something to land there.
      await gate
      return true
    },
    async threadEvents(threadId: string, afterSeq: number) {
      return logs.get(threadId)!.filter((e) => e.seq > afterSeq)
    },
    async stopThread(threadId: string) {
      calls.push(`stop ${threadId}`)
    },
    async archiveThread(threadId: string) {
      calls.push(`archive ${threadId}`)
    },
  }
  return { client: client as unknown as BbClient, raw: client, calls, sent, created, logs }
}

const reply = (text: string): Array<Omit<BbThreadEvent, "seq">> => [
  { type: "turn/started", data: {} },
  { type: "item/started", data: { item: { type: "agentMessage", id: "m1", text: "" } } },
  { type: "item/agentMessage/delta", data: { itemId: "m1", delta: text.slice(0, 5) } },
  { type: "item/agentMessage/delta", data: { itemId: "m1", delta: text.slice(5) } },
  { type: "item/completed", data: { item: { type: "agentMessage", id: "m1", text } } },
  { type: "turn/completed", data: { status: "completed" } },
]

function harness(script = (_t: string) => reply("Hello there."), gate?: Promise<void>) {
  const bb = fakeBb(script, gate)
  const events: MascotBrainEvent[] = []
  const threads = createMascotThreads({
    client: async () => bb.client,
    resolve: async () => ({ projectId: "p1", environment: { type: "host", hostId: "h", workspace: { type: "unmanaged", path: "/x" } } }),
    modelChoice: async () => ({ providerId: "claude-code", model: "m", reasoningLevel: "high" }),
    fallbackCwd: () => "/home-scratch",
    emit: (e) => events.push(e),
    sleep: async () => {},
  })
  return { bb, events, threads }
}

describe("mascot threads", () => {
  it("streams cumulative text and ends with exactly one done", async () => {
    const { events, threads } = harness()
    await threads.turn({ turnId: "t1", cwd: "/proj", standing: "RULES", prompt: "hi" })
    const kinds = events.map((e) => e.kind)
    expect(kinds[0]).toBe("waking")
    expect(kinds.filter((k) => k === "done" || k === "error")).toEqual(["done"])
    const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text)
    expect(texts.at(-1)).toBe("Hello there.")
    expect(texts[0]).toBe("Hello")
  })

  it("creates the thread hidden, with the standing rules, on the user's model at low reasoning", async () => {
    const { bb, threads } = harness()
    await threads.turn({ turnId: "t1", cwd: "/proj", standing: "RULES", prompt: "hi" })
    expect(bb.created[0].visibility).toBe("hidden")
    expect((bb.created[0].input as Array<{ text: string }>)[0].text).toBe("RULES\n\nhi")
    expect((bb.created[0].execution as { reasoningLevel: string }).reasoningLevel).toBe(MASCOT_REASONING_LEVEL)
  })

  it("reuses the warm thread and never steers a running turn", async () => {
    const { bb, events, threads } = harness()
    await threads.warm("/proj", "RULES")
    await threads.turn({ turnId: "t1", cwd: "/proj", standing: "RULES", prompt: "first" })
    await threads.turn({ turnId: "t2", cwd: "/proj", standing: "RULES", prompt: "second" })
    expect(bb.created).toHaveLength(1)
    expect(bb.sent.map((s) => s.text)).toEqual(["first", "second"])
    expect(bb.sent.every((s) => s.mode === "queue-if-active")).toBe(true)
    expect(events.some((e) => e.kind === "waking")).toBe(false)
    // Only the events AFTER the send are this turn's: the warm-up's reply is not re-read.
    expect(events.filter((e) => e.turnId === "t2" && e.kind === "done")).toHaveLength(1)
  })

  it("keeps one thread per folder, and a null cwd uses the scratch folder", async () => {
    const { bb, threads } = harness()
    await threads.turn({ turnId: "a", cwd: "/one", standing: "R", prompt: "x" })
    await threads.turn({ turnId: "b", cwd: "/two", standing: "R", prompt: "x" })
    await threads.turn({ turnId: "c", cwd: null, standing: "R", prompt: "x" })
    await threads.turn({ turnId: "d", cwd: "/one", standing: "R", prompt: "y" })
    expect(bb.created).toHaveLength(3)
  })

  it("a stopped turn emits nothing more, and bb is told to stop", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const { bb, events, threads } = harness(undefined, gate)
    await threads.warm("/proj", "R")
    const p = threads.turn({ turnId: "t1", cwd: "/proj", standing: "R", prompt: "long" })
    // Let the turn post its message and park in the long poll…
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(bb.sent).toHaveLength(1)
    await threads.stop("t1")
    // …then let bb's answer arrive AFTER the stop: none of it may be emitted.
    release()
    await p
    expect(events.filter((e) => e.turnId === "t1")).toEqual([])
    expect(bb.calls.some((c) => c.startsWith("stop"))).toBe(true)
  })

  it("converts a native question into one question event and ends the turn", async () => {
    const { bb, events, threads } = harness(() => [
      { type: "item/started", data: { item: { type: "agentMessage", id: "m1", text: "Let me check." } } },
      {
        type: "system/interaction/lifecycle",
        data: { interaction: { status: "pending", payload: { kind: "question", questions: [{ question: "Which card?", options: [{ label: "A" }, { label: "B" }] }] } } },
      },
    ])
    await threads.turn({ turnId: "t1", cwd: "/proj", standing: "R", prompt: "x" })
    const q = events.find((e) => e.kind === "question")
    expect(q).toMatchObject({ question: "Which card?", options: ["A", "B"] })
    expect(events.filter((e) => e.kind === "done" || e.kind === "error")).toHaveLength(1)
    expect(bb.calls.some((c) => c.startsWith("stop"))).toBe(true)
  })

  it("chips tool calls", async () => {
    const { events, threads } = harness(() => [
      { type: "item/started", data: { item: { type: "toolCall", id: "c1", tool: "mcp__bb-bridge__listLayers", arguments: {} } } },
      ...reply("Done."),
    ])
    await threads.turn({ turnId: "t1", cwd: "/p", standing: "R", prompt: "x" })
    expect(events.find((e) => e.kind === "tool")).toMatchObject({ name: "mcp__bb-bridge__listLayers" })
  })

  it("reports a failed turn with no text as an error, once", async () => {
    const { events, threads } = harness(() => [{ type: "turn/completed", data: { status: "failed", error: { message: "rate limited" } } }])
    await threads.turn({ turnId: "t1", cwd: "/p", standing: "R", prompt: "x" })
    expect(events.filter((e) => e.kind === "error")).toEqual([{ turnId: "t1", kind: "error", message: "rate limited" }])
    expect(events.some((e) => e.kind === "done")).toBe(false)
  })

  it("an unreachable bb is one error, not a hang", async () => {
    const events: MascotBrainEvent[] = []
    const threads = createMascotThreads({
      client: async () => { throw new Error("bb is down") },
      resolve: async () => { throw new Error("unused") },
      fallbackCwd: () => "/s",
      emit: (e) => events.push(e),
    })
    await threads.turn({ turnId: "t1", cwd: "/p", standing: "R", prompt: "x" })
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe("error")
  })

  it("reset archives every thread", async () => {
    const { bb, threads } = harness()
    await threads.warm("/a", "R")
    await threads.warm("/b", "R")
    await threads.reset()
    expect(bb.calls.filter((c) => c.startsWith("archive"))).toHaveLength(2)
    await threads.turn({ turnId: "t", cwd: "/a", standing: "R", prompt: "x" })
    expect(bb.created).toHaveLength(3)
  })
})

describe("a warm still in flight", () => {
  it("is waited for by the first turn — one thread, never two racing in one folder", async () => {
    let release!: () => void
    const slow = new Promise<void>((r) => { release = r })
    const { bb, events, threads } = harness()
    const create = bb.raw.createThread.bind(bb.raw)
    bb.raw.createThread = async (args: Record<string, unknown>) => {
      await slow
      return create(args)
    }
    const warming = threads.warm("/proj", "RULES")
    const turn = threads.turn({ turnId: "t1", cwd: "/proj", standing: "RULES", prompt: "hi" })
    for (let i = 0; i < 20; i++) await Promise.resolve()
    release()
    await warming
    await turn
    expect(bb.created).toHaveLength(1)
    expect(bb.sent.map((s) => s.text)).toEqual(["hi"])
    expect(events.filter((e) => e.turnId === "t1" && e.kind === "done")).toHaveLength(1)
  })
})

describe("a turn still making its thread (Tellaflow)", () => {
  it("is waited for by a warm that lands meanwhile — one thread, not two in one folder", async () => {
    let release!: () => void
    const slow = new Promise<void>((r) => { release = r })
    const { bb, threads } = harness()
    const create = bb.raw.createThread.bind(bb.raw)
    bb.raw.createThread = async (args: Record<string, unknown>) => {
      await slow
      return create(args)
    }
    const turn = threads.turn({ turnId: "t1", cwd: "/proj", standing: "RULES", prompt: "hi" })
    for (let i = 0; i < 20; i++) await Promise.resolve()
    const warmed = threads.warm("/proj", "RULES")
    release()
    await turn
    expect(await warmed).toEqual({ ok: true })
    expect(bb.created).toHaveLength(1)
  })
})

describe("choosing a provider with no pick", () => {
  function noPick() {
    const bb = fakeBb(() => reply("Hi."))
    const events: MascotBrainEvent[] = []
    const threads = createMascotThreads({
      client: async () => bb.client,
      resolve: async () => ({ projectId: "p1", environment: { type: "host", hostId: "h", workspace: { type: "unmanaged", path: "/x" } } }),
      modelChoice: async () => null,
      fallbackCwd: () => "/s",
      emit: (e) => events.push(e),
      sleep: async () => {},
    })
    return { bb, events, threads }
  }

  it("uses a provider this machine has signed in, not bb's default", async () => {
    const { bb, events, threads } = noPick()
    bb.raw.readyList = ["acp-opencode", "claude-code"]
    await threads.turn({ turnId: "t", cwd: "/p", standing: "R", prompt: "x" })
    expect((bb.created[0].execution as { providerId: string }).providerId).toBe("claude-code")
    expect(events.at(-1)?.kind).toBe("done")
  })

  it("falls back to bb's default when that provider is refused", async () => {
    const { bb, events, threads } = noPick()
    bb.raw.refuse = (args) => !!args.execution
    await threads.turn({ turnId: "t", cwd: "/p", standing: "R", prompt: "x" })
    expect(bb.created).toHaveLength(1)
    expect(bb.created[0].execution).toBeUndefined()
    expect(events.at(-1)?.kind).toBe("done")
  })

  it("reports the last refusal when nothing can run", async () => {
    const { bb, events, threads } = noPick()
    bb.raw.refuse = () => true
    await threads.turn({ turnId: "t", cwd: "/p", standing: "R", prompt: "x" })
    expect(events.filter((e) => e.kind === "error")).toHaveLength(1)
  })
})

describe("questionFromInteraction", () => {
  it("ignores a settled interaction and an approval", () => {
    expect(questionFromInteraction({ interaction: { status: "resolved", payload: { question: "x" } } })).toBeNull()
    expect(questionFromInteraction({ interaction: { status: "pending", payload: { kind: "approval" } } })).toBeNull()
  })
  it("never returns an empty question", () => {
    expect(questionFromInteraction({ interaction: { status: "pending", payload: {} } })?.question).toBeTruthy()
  })
})
