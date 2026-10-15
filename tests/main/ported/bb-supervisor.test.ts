// Ported from canvas (bb-supervisor.test.ts) with the code it tests; paths and names adjusted.
import { describe, it, expect, beforeEach, vi } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  BB_APP_VERSION,
  bundledLauncher,
  assertSafeDataDir,
  bbDataDir,
  bbDaemonPort,
  bbServerPort,
  buildLaunchCommand,
  ensureBbServer,
  loginShellInvocation,
  resetBbServerState,
  stopBbServer,
  type BbSpawn,
  type BbSpawnedProcess,
} from "../../../src/main/jarvis/bb/supervisor"
import type { BbFetch, BbHttpResponse } from "../../../src/main/jarvis/bb/client"

const here = path.dirname(fileURLToPath(import.meta.url))

/** A bb server that answers every readiness probe, or a stage of one that does
 *  not — the three probes are the whole point of the gate, so each test says
 *  which of them the fake server has got to. */
function fakeFetch(options: {
  health?: boolean
  config?: boolean
  hosts?: unknown
  onCall?: (url: string) => void
}): BbFetch {
  const ok = (body: unknown): BbHttpResponse => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  })
  const dead: BbHttpResponse = {
    ok: false,
    status: 503,
    text: async () => "not ready",
  }
  return async (url) => {
    options.onCall?.(url)
    if (url.endsWith("/health")) return options.health === false ? dead : ok({})
    if (url.endsWith("/system/config")) {
      return options.config === false ? dead : ok({ hostDaemonPort: 38887 })
    }
    if (url.endsWith("/hosts")) {
      return ok(options.hosts ?? [{ id: "host-1", name: "mac", status: "connected" }])
    }
    return dead
  }
}

/** A launcher. `exitsOnTerm` is bb-app finishing its own shutdown; without
 *  it the launcher hangs on SIGTERM the way a wedged one does. */
function fakeChild(options: { exitsOnTerm?: boolean } = {}): BbSpawnedProcess & { killed: string[] } {
  const killed: string[] = []
  const onExit: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  return {
    killed,
    pid: 4242,
    kill(signal) {
      killed.push(String(signal))
      if (options.exitsOnTerm && signal === "SIGTERM") for (const cb of onExit.splice(0)) cb(null, "SIGTERM")
      return true
    },
    once(event: string, listener: (...args: never[]) => void) {
      if (event === "exit") onExit.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
      return this
    },
    stdout: null,
    stderr: null,
  } as BbSpawnedProcess & { killed: string[] }
}

async function startOwned(child: BbSpawnedProcess): Promise<void> {
  let up = false
  await ensureBbServer({
    fetchImpl: async (url, init) => {
      if (!up && url.endsWith("/health")) {
        return { ok: false, status: 503, text: async () => "" }
      }
      return fakeFetch({})(url, init)
    },
    spawnImpl: () => {
      up = true
      return child
    },
    homeDir: "/home/me",
    env: {},
    isPortInUse: async () => false,
    sleep: async () => {},
  })
}

beforeEach(() => {
  resetBbServerState()
})

describe("the launch line", () => {
  it("runs the bundled bb under a plain node", () => {
    const command = buildLaunchCommand({
      launcher: "/app/node_modules/bb-app/dist/bb-app.js",
      dataDir: "/home/me/.tellaflow/bb",
      serverPort: 38886,
      daemonPort: 38887,
      version: "0.42.1",
    })
    // Never under Electron: bb pins its own better-sqlite3 against the Node
    // ABI, and ELECTRON_RUN_AS_NODE would put it back inside Electron's.
    expect(command).toContain("exec node '/app/node_modules/bb-app/dist/bb-app.js' start")
    expect(command).toContain("--data-dir '/home/me/.tellaflow/bb'")
    // The one prerequisite the app cannot ship, said plainly rather than
    // surfacing as "the backend did not become ready".
    expect(command).toContain("needs Node on your PATH")
    expect(command).not.toContain("npx")
  })

  it("falls back to a downloaded bb only when nothing is bundled", () => {
    const command = buildLaunchCommand({
      launcher: null,
      dataDir: "/home/me/.tellaflow/bb",
      serverPort: 38886,
      daemonPort: 38887,
      version: "0.42.1",
    })
    expect(command).toContain("command -v bb-app")
    expect(command).toContain("exec npx -y bb-app@0.42.1 start")
  })

  it("binds the server to loopback explicitly, not to whatever bb defaults to", () => {
    for (const launcher of ["/app/bb-app.js", null]) {
      const command = buildLaunchCommand({
        launcher,
        dataDir: "/tmp/bb",
        serverPort: 1,
        daemonPort: 2,
        version: "0.42.1",
      })
      expect(command).toContain("--server-bind-host 127.0.0.1")
    }
  })

  it("quotes a data dir with a space in it", () => {
    const command = buildLaunchCommand({
      launcher: null,
      dataDir: "/Users/me/Library/Application Support/canvas",
      serverPort: 1,
      daemonPort: 2,
      version: "0.42.1",
    })
    expect(command).toContain("'/Users/me/Library/Application Support/canvas'")
  })
})

describe("the bundled bb", () => {
  it("is the version this app pins", () => {
    // The dependency and the pin are two places one number is written, and the
    // supervisor's fallback would quietly download a different bb than the one
    // in node_modules if they drifted.
    const manifest = JSON.parse(
      readFileSync(path.resolve(here, "../../../package.json"), "utf8")
    ) as { dependencies: Record<string, string> }
    expect(manifest.dependencies["bb-app"]).toBe(BB_APP_VERSION)
  })

  it("resolves the launcher that ships in node_modules", () => {
    const launcher = bundledLauncher()
    expect(launcher).not.toBeNull()
    expect(existsSync(launcher!)).toBe(true)
  })

  it("reads a packaged app's unpacked copy, since bb cannot run from inside an asar", () => {
    const inside =
      "/Apps/Canvas.app/Contents/Resources/app.asar/node_modules/bb-app/dist/bb-app.js"
    const seen: string[] = []
    const launcher = bundledLauncher(
      () => inside,
      (file) => {
        seen.push(file)
        return true
      }
    )
    expect(launcher).toBe(
      "/Apps/Canvas.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/dist/bb-app.js"
    )
    expect(seen[0]).toContain("app.asar.unpacked")
  })

  it("answers null when the dependency is not installed", () => {
    expect(
      bundledLauncher(() => {
        throw new Error("Cannot find module 'bb-app/dist/bb-app.js'")
      })
    ).toBeNull()
  })
})

describe("where the data lives", () => {
  it("is under the home dir, and never the user's own bb", () => {
    expect(bbDataDir("/home/me", {})).toBe("/home/me/.tellaflow/bb")
    expect(() => assertSafeDataDir("/home/me/.bb", "/home/me")).toThrow(
      /own data dir/
    )
    expect(() => assertSafeDataDir("/home/me/.bb/nested", "/home/me")).toThrow()
    expect(() => assertSafeDataDir("/home/me/.tellaflow/bb", "/home/me")).not.toThrow()
  })

  it("takes the env override, so an automated run can be pointed elsewhere", () => {
    expect(bbDataDir("/home/me", { TELLAFLOW_BB_DATA_DIR: "/tmp/throwaway" })).toBe(
      "/tmp/throwaway"
    )
    expect(bbServerPort({ TELLAFLOW_BB_SERVER_PORT: "40000" })).toBe(40000)
    expect(bbDaemonPort({ TELLAFLOW_BB_DAEMON_PORT: "40001" })).toBe(40001)
  })

  it("ignores a nonsense port rather than launching against it", () => {
    expect(bbServerPort({ TELLAFLOW_BB_SERVER_PORT: "not-a-port" })).toBe(38886)
    expect(bbServerPort({ TELLAFLOW_BB_SERVER_PORT: "99999" })).toBe(38886)
  })
})

describe("bringing the server up", () => {
  it("adopts a server that is already listening instead of spawning a second", async () => {
    const spawnImpl = vi.fn() as unknown as BbSpawn
    const handle = await ensureBbServer({
      fetchImpl: fakeFetch({}),
      spawnImpl,
      homeDir: "/home/me",
      env: {},
      isPortInUse: async () => false,
    })
    expect(handle.spawned).toBe(false)
    expect(handle.hostId).toBe("host-1")
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it("refuses a listening server whose host never connects — a thread cannot run there", async () => {
    await expect(
      ensureBbServer({
        fetchImpl: fakeFetch({
          hosts: [{ id: "host-1", name: "mac", status: "disconnected" }],
        }),
        homeDir: "/home/me",
        env: {},
        readyTimeoutMs: 0,
        now: () => 1,
        sleep: async () => {},
      })
    ).rejects.toThrow(/never reported a connected host/)
  })

  it("spawns one when nothing answers, with bb's telemetry off and our data dir", async () => {
    const child = fakeChild()
    const spawns: Array<{ env: NodeJS.ProcessEnv; args: string[] }> = []
    let up = false
    const spawnImpl: BbSpawn = (_command, args, options) => {
      spawns.push({ env: options.env, args })
      up = true
      return child
    }
    const handle = await ensureBbServer({
      // The first probe has to fail or there would be nothing to spawn; the
      // server comes up as soon as the launcher runs.
      fetchImpl: async (url, init) => {
        if (!up && url.endsWith("/health")) {
          return { ok: false, status: 503, text: async () => "" }
        }
        return fakeFetch({})(url, init)
      },
      spawnImpl,
      homeDir: "/home/me",
      env: { SHELL: "/bin/bash" },
      launcher: "/app/node_modules/bb-app/dist/bb-app.js",
      isPortInUse: async () => false,
      sleep: async () => {},
    })
    expect(handle.spawned).toBe(true)
    expect(spawns).toHaveLength(1)
    expect(spawns[0].args[0]).toBe("-lc")
    expect(spawns[0].env.BB_TELEMETRY).toBe("false")
    expect(spawns[0].env.BB_DATA_DIR).toBe("/home/me/.tellaflow/bb")
    expect(spawns[0].env.BB_SERVER_BIND_HOST).toBe("127.0.0.1")
  })

  it("refuses to fork when the host-daemon port is held by an orphan", async () => {
    const spawnImpl = vi.fn() as unknown as BbSpawn
    await expect(
      ensureBbServer({
        fetchImpl: fakeFetch({ health: false }),
        spawnImpl,
        homeDir: "/home/me",
        env: {},
        isPortInUse: async (port) => port === 38887,
      })
    ).rejects.toThrow(/host-daemon port :38887 is already in use/)
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it("shares one launcher between callers that arrive in the same tick", async () => {
    let spawned = 0
    let up = false
    const spawnImpl: BbSpawn = () => {
      spawned += 1
      up = true
      return fakeChild()
    }
    const options = {
      fetchImpl: async (url: string, init?: Parameters<BbFetch>[1]) => {
        if (!up && url.endsWith("/health")) {
          return { ok: false, status: 503, text: async () => "" }
        }
        return fakeFetch({})(url, init)
      },
      spawnImpl,
      homeDir: "/home/me",
      env: {},
      isPortInUse: async () => false,
      sleep: async () => {},
    }
    const [a, b] = await Promise.all([
      ensureBbServer(options),
      ensureBbServer(options),
    ])
    expect(spawned).toBe(1)
    expect(a).toBe(b)
  })

  it("gives up with the launcher's own stderr rather than an opaque timeout", async () => {
    const child = fakeChild()
    let onData: ((chunk: string) => void) | null = null
    child.stderr = {
      on(_event, cb) {
        onData = cb as (chunk: string) => void
        return this
      },
    }
    await expect(
      ensureBbServer({
        fetchImpl: async (url) => {
          if (url.endsWith("/health")) {
            onData?.("npm ERR! network unreachable")
            return { ok: false, status: 503, text: async () => "" }
          }
          return { ok: false, status: 503, text: async () => "" }
        },
        spawnImpl: () => child,
        homeDir: "/home/me",
        env: {},
        isPortInUse: async () => false,
        readyTimeoutMs: 0,
        now: () => 1,
        sleep: async () => {},
      })
    ).rejects.toThrow(/network unreachable/)
    expect(child.killed).toEqual(["SIGTERM"])
  })
})

describe("the launcher's output", () => {
  it("reads stdout as well as stderr, so a chatty bb never fills the pipe and blocks", async () => {
    // A piped stream nobody reads fills at ~64KB and then blocks the child's
    // next write: bb would stop answering mid-session with nothing logged.
    const child = fakeChild()
    const reading: string[] = []
    child.stdout = {
      on(event) {
        reading.push(`stdout:${event}`)
        return this
      },
    }
    child.stderr = {
      on(event) {
        reading.push(`stderr:${event}`)
        return this
      },
    }
    let up = false
    await ensureBbServer({
      fetchImpl: async (url, init) => {
        if (!up && url.endsWith("/health")) {
          return { ok: false, status: 503, text: async () => "" }
        }
        return fakeFetch({})(url, init)
      },
      spawnImpl: () => {
        up = true
        return child
      },
      homeDir: "/home/me",
      env: {},
      isPortInUse: async () => false,
      sleep: async () => {},
    })
    expect(reading).toContain("stdout:data")
    expect(reading).toContain("stderr:data")
  })

  it("runs the launch line under the user's login shell", () => {
    expect(loginShellInvocation("exec node x.js", { SHELL: "/bin/bash" })).toEqual({
      shell: "/bin/bash",
      args: ["-lc", "exec node x.js"],
    })
    expect(loginShellInvocation("true", {}).shell).toBe("/bin/zsh")
    expect(loginShellInvocation("true", { SHELL: "/bin/bash" }, "/bin/fish").shell).toBe("/bin/fish")
  })
})

describe("stopping", () => {
  it("stops a server we started, and waits for its launcher to finish", async () => {
    const child = fakeChild({ exitsOnTerm: true })
    await startOwned(child)
    const killTree = vi.fn()
    await stopBbServer({ graceMs: 1_000, killTree })
    expect(child.killed).toEqual(["SIGTERM"])
    expect(killTree).not.toHaveBeenCalled()
  })

  it("kills the launcher and everything under it when SIGTERM does not stop it", async () => {
    const child = fakeChild()
    await startOwned(child)
    const killTree = vi.fn()
    await stopBbServer({ graceMs: 10, killTree })
    expect(child.killed).toEqual(["SIGTERM"])
    expect(killTree).toHaveBeenCalledWith(4242)
  })

  it("stops a launcher that is still starting — a quit during bb's first start", async () => {
    const child = fakeChild({ exitsOnTerm: true })
    const starting = ensureBbServer({
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }),
      spawnImpl: () => child,
      homeDir: "/home/me",
      env: {},
      isPortInUse: async () => false,
      sleep: () => new Promise((r) => setTimeout(r, 5)),
      readyTimeoutMs: 60_000,
    }).catch((err: Error) => err)
    // Let it get past the "is anything listening?" probe and fork.
    while (child.killed.length === 0 && !(await Promise.race([starting.then(() => true), new Promise((r) => setTimeout(() => r(false), 5))]))) {
      await stopBbServer({ graceMs: 1_000, killTree: vi.fn() })
    }
    expect(child.killed).toContain("SIGTERM")
    expect(await starting).toBeInstanceOf(Error)
  })

  it("leaves a server we adopted alone — it is somebody else's work", async () => {
    const spawnImpl = vi.fn() as unknown as BbSpawn
    await ensureBbServer({
      fetchImpl: fakeFetch({}),
      spawnImpl,
      homeDir: "/home/me",
      env: {},
    })
    await expect(stopBbServer()).resolves.toBeUndefined()
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
