/**
 * `proxy install`'s Command.action logic — isolated via RUFLO_STATE_DIR,
 * install itself mocked out (real downloads belong in manual/E2E testing,
 * already verified against the real meta-proxy v0.1.0 release).
 *
 * Regression coverage for a real bug found during E2E testing: the
 * proxy-install consent grant must never happen before required flags are
 * validated. The original implementation checked consent (and, on --yes,
 * recorded it) BEFORE checking for --release — so `proxy install --yes`
 * with no --release recorded consent even though the command then failed,
 * which meant a LATER, parameter-complete `proxy install --release x.y.z`
 * silently skipped the disclosure the user should have seen once with real
 * information. Fixed by validating --release first.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CommandContext } from '../src/types.js';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-install-cmd-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
  vi.resetModules();
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function ctxWithFlags(flags: Record<string, unknown>): CommandContext {
  return { args: [], flags: { _: [], ...flags }, cwd: process.cwd(), interactive: false };
}

async function getInstallSub() {
  const { proxyLifecycleSubcommands } = await import('../src/commands/proxy-lifecycle.js');
  const sub = proxyLifecycleSubcommands.find((c) => c.name === 'install');
  if (!sub) throw new Error('install subcommand not found');
  return sub;
}

describe('proxy install — parameter validation happens before any consent side-effect', () => {
  it('--yes with no --release fails WITHOUT recording proxy-install consent', async () => {
    const installSub = await getInstallSub();
    const result = await installSub.action!(ctxWithFlags({ yes: true }));
    expect(result?.success).toBe(false);

    const { hasConsent } = await import('../src/funnel/index.js');
    expect(hasConsent('proxy-install')).toBe(false);
  });

  it('a later, parameter-complete call still shows the disclosure (consent was never silently granted)', async () => {
    const installSub = await getInstallSub();

    // First call: --yes but no --release — must fail, must not grant consent (asserted above).
    await installSub.action!(ctxWithFlags({ yes: true }));

    // Second call: --release present, but NO --yes this time — must show the
    // disclosure and refuse (not silently proceed as if already consented).
    const second = await installSub.action!(ctxWithFlags({ release: '0.1.0' }));
    expect(second?.success).toBe(true);
    expect((second?.data as { confirmed?: boolean } | undefined)?.confirmed).toBe(false);
  });

  it('missing --release is rejected even when consent already exists from a prior install', async () => {
    const { recordConsent } = await import('../src/funnel/consent.js');
    recordConsent('proxy-install', true, 'test-seed');

    const installSub = await getInstallSub();
    const result = await installSub.action!(ctxWithFlags({ yes: true }));
    expect(result?.success).toBe(false);
  });
});
