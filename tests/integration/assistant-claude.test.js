/**
 * Real end-to-end test of the assistant against the signed-in Claude Code CLI
 * (no API key — it uses whatever account `claude` is logged in with).
 *
 * The Mac tools are replaced with recording fakes so this runs on any OS and
 * never touches the machine; everything else — prompt, CLI invocation with
 * tools disabled, JSON step parsing, agent loop, approvals — is the real code.
 *
 * Skipped automatically when the `claude` CLI isn't installed.
 *   npm run test:assistant-e2e
 */
import { describe, it, expect } from 'vitest';
import { resolveCli, createClaudeProvider } from '../../src/main/assistant/providers.js';
import { runAgent } from '../../src/main/assistant/agent.js';

const claudePath = await resolveCli('claude');
const enabled = !!claudePath && process.env.TELLAFLOW_SKIP_AI_E2E !== '1';

function recordingTools(log) {
  return [
    { name: 'get_date_time', description: 'Current local date and time.', args: {}, readOnly: true, run: async () => new Date('2026-10-15T09:30:00').toString() },
    { name: 'list_running_apps', description: 'Names of running apps.', args: {}, readOnly: true, run: async () => 'Finder, Safari, Slack' },
    { name: 'open_app', description: 'Open an app by name.', args: { name: 'string, app name' }, run: async ({ name }) => { log.push(['open_app', name]); return `Opened ${name}.`; } },
    { name: 'set_volume', description: 'Set output volume 0-100.', args: { level: 'number 0-100' }, run: async ({ level }) => { log.push(['set_volume', Number(level)]); return `Volume set to ${level}.`; } },
    {
      name: 'create_reminder',
      description: 'Add a reminder to the Reminders app.',
      args: { title: 'string', notes: 'string, optional', due: 'ISO date-time, optional' },
      run: async (args) => { log.push(['create_reminder', args]); return `Reminder "${args.title}" created.`; },
    },
  ];
}

describe.skipIf(!enabled)('assistant ↔ Claude Code CLI (real)', () => {
  const provider = createClaudeProvider();

  it('plans and executes a multi-step request, then finishes', async () => {
    const log = [];
    const steps = [];
    const res = await runAgent({
      request: 'Open the Calculator app and set the volume to 25.',
      complete: (p, o) => provider.complete(p, o),
      tools: recordingTools(log),
      approve: async () => true,
      onStep: (s) => steps.push(s),
      maxSteps: 6,
    });
    expect(res.status).toBe('done');
    expect(log).toContainEqual(['open_app', 'Calculator']);
    expect(log).toContainEqual(['set_volume', 25]);
    expect(res.final.length).toBeGreaterThan(0);
    // The chain the UI shows: at least two actions with results, then a final.
    expect(steps.filter((s) => s.type === 'action').length).toBeGreaterThanOrEqual(2);
    expect(steps.filter((s) => s.type === 'result').every((s) => s.ok)).toBe(true);
    expect(steps.at(-1).type).toBe('final');
  }, 300_000);

  it('uses read-only tools to answer and respects a denied action', async () => {
    const log = [];
    const res = await runAgent({
      request: 'Remind me to water the plants. If you cannot, just say so.',
      complete: (p, o) => provider.complete(p, o),
      tools: recordingTools(log),
      approve: async () => false, // user says no
      maxSteps: 4,
    });
    expect(res.status).toBe('done');
    expect(log).toEqual([]); // nothing executed
    expect(res.steps.some((s) => s.type === 'approval' && s.status === 'denied')).toBe(true);
  }, 300_000);
});
