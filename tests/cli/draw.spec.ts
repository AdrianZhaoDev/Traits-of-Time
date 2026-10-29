import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from '../../tools/lib/FileStateStore.js';
import { writeContent } from '../helpers/content.js';
import {
  chainLife, chainStartText, cliFixtures, expectJsonError, expectSuccess, runCli,
  slotBytes, startCli, successJson, type DrawJson,
} from './helpers.js';

const fixture = cliFixtures();

function drawArgs(content: string, state: string, commandId: string, count: number, pool = 'POOL_PITY'): string[] {
  return ['--content', content, '--state', state, '--pool', pool, '--count', String(count), '--command-id', commandId, '--json'];
}

describe('draw: external JSON, durable commands and pool cursors', () => {
  it('imports a complete external package and draws only the JSON-configured epic card one hundred times', async () => {
    const context = await fixture((bundle) => {
      const pool = bundle.pools.find((entry) => entry.id === 'POOL_BASIC')!;
      for (const entry of pool.entries) entry.weight = entry.card_id === 'CARD_EPIC' ? 1 : 0;
      pool.hard_pity = null;
    });
    const result = successJson<DrawJson>(await runCli('draw', [
      ...drawArgs(context.content, context.state, 'external-100', 100, 'POOL_BASIC'), '--seed', '0',
    ]));
    expect(result).toMatchObject({ pool_id: 'POOL_BASIC', seed: 0, revision: 1 });
    expect(result.content_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.items).toHaveLength(100);
    expect(result.items).toEqual(Array.from({ length: 100 }, (_, index) => ({
      card_id: 'CARD_EPIC', rarity: 'SSR', draw_index: index + 1,
      forced_pity: false, pity_before: 0, pity_after: 0, conditional_probability: 1,
    })));
    const persisted = await load<{ payload: { seed: number; pools: Record<string, { misses: number; total_draws: number; rng: { draws: number } }> } }>(context.state);
    expect(persisted?.payload).toMatchObject({
      seed: 0, pools: { POOL_BASIC: { misses: 0, total_draws: 100, rng: { draws: 100 } } },
    });
  });

  it('returns byte-identical ten-draw retries, preserves the eleventh draw, and ignores only the omitted default seed', async () => {
    const context = await fixture();
    const firstArgs = drawArgs(context.content, context.state, 'first-ten', 10);
    const firstProcess = await runCli('draw', [...firstArgs, '--seed', '1641']);
    const first = successJson<DrawJson>(firstProcess);
    expect(first.items).toHaveLength(10);
    expect(first.items.map((item) => item.draw_index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(first.items.map((item) => item.card_id)).toContain('CARD_EPIC');
    const tenSlots = await slotBytes(context.state);

    const retry = await runCli('draw', firstArgs);
    expect(successJson<DrawJson>(retry)).toEqual(first);
    expect(retry.stdout).toBe(firstProcess.stdout);
    expect(await slotBytes(context.state)).toEqual(tenSlots);

    const next = successJson<DrawJson>(await runCli('draw', drawArgs(context.content, context.state, 'eleventh', 1)));
    expect(next).toMatchObject({ seed: 1641, revision: first.revision + 1, content_fingerprint: first.content_fingerprint });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ draw_index: 11, pity_before: first.items[9]!.pity_after });
    const all = successJson<DrawJson>(await runCli('draw', [
      ...drawArgs(context.content, join(context.root, 'control'), 'eleven-together', 11), '--seed', '1641',
    ]));
    expect([...first.items, ...next.items]).toEqual(all.items);

    const elevenSlots = await slotBytes(context.state);
    const oldRetry = await runCli('draw', firstArgs);
    expect(successJson<DrawJson>(oldRetry)).toEqual(first);
    expect(oldRetry.stdout).toBe(firstProcess.stdout);
    expect(await slotBytes(context.state)).toEqual(elevenSlots);
  });

  it('rejects a conflicting command or explicit seed without changing any persisted slot', async () => {
    const context = await fixture();
    successJson<DrawJson>(await runCli('draw', [...drawArgs(context.content, context.state, 'used', 2), '--seed', '12']));
    const before = await slotBytes(context.state);
    expectJsonError(await runCli('draw', drawArgs(context.content, context.state, 'used', 3)), 1, 'COMMAND_ID_CONFLICT');
    expect(await slotBytes(context.state)).toEqual(before);
    expectJsonError(await runCli('draw', [...drawArgs(context.content, context.state, 'next', 1), '--seed', '13']), 1, 'SEED_MISMATCH');
    expect(await slotBytes(context.state)).toEqual(before);
    expectJsonError(await runCli('draw', drawArgs(context.content, context.state, 'unknown', 1, 'DOES_NOT_EXIST')), 1, 'POOL_NOT_FOUND');
    expect(await slotBytes(context.state)).toEqual(before);
    const accepted = successJson<DrawJson>(await runCli('draw', [...drawArgs(context.content, context.state, 'next', 1), '--seed', '12']));
    expect(accepted.items[0]!.draw_index).toBe(3);
  });

  it('refuses a same-version content change, preserves the old save, and permits a fresh state directory', async () => {
    const context = await fixture();
    const first = successJson<DrawJson>(await runCli('draw', drawArgs(context.content, context.state, 'one', 1, 'POOL_BASIC')));
    const before = await slotBytes(context.state);
    const pool = context.bundle.pools.find((entry) => entry.id === 'POOL_BASIC')!;
    for (const entry of pool.entries) entry.weight = entry.card_id === 'CARD_EPIC' ? 1 : 0;
    pool.hard_pity = null;
    await writeContent(context.content, context.bundle);
    expectJsonError(await runCli('draw', drawArgs(context.content, context.state, 'two', 1, 'POOL_BASIC')), 1, 'CONTENT_MISMATCH');
    expect(await slotBytes(context.state)).toEqual(before);
    const fresh = successJson<DrawJson>(await runCli('draw', drawArgs(context.content, join(context.root, 'fresh'), 'one', 1, 'POOL_BASIC')));
    expect(fresh.content_fingerprint).not.toBe(first.content_fingerprint);
    expect(fresh.items[0]).toMatchObject({ card_id: 'CARD_EPIC', draw_index: 1, conditional_probability: 1 });
  });

  it('rejects an oversized nonreplacement batch atomically and resets candidates for each successful call', async () => {
    const context = await fixture();
    const first = successJson<DrawJson>(await runCli('draw', drawArgs(context.content, context.state, 'first', 3, 'POOL_UNIQUE')));
    expect(first.items.map((item) => item.card_id).sort()).toEqual(['CARD_COMMON', 'CARD_EPIC', 'CARD_RARE']);
    const before = await slotBytes(context.state);
    expectJsonError(await runCli('draw', drawArgs(context.content, context.state, 'retryable', 4, 'POOL_UNIQUE')), 1, 'INSUFFICIENT_CANDIDATES');
    expect(await slotBytes(context.state)).toEqual(before);
    const next = successJson<DrawJson>(await runCli('draw', drawArgs(context.content, context.state, 'retryable', 3, 'POOL_UNIQUE')));
    expect(next.items.map((item) => item.card_id).sort()).toEqual(['CARD_COMMON', 'CARD_EPIC', 'CARD_RARE']);
    expect(next.items.map((item) => item.draw_index)).toEqual([4, 5, 6]);
  });
});

describe('CLI locks: real concurrent writers and abnormal exits', () => {
  it('rejects another writer while play owns a directory and releases its lock on normal quit', async () => {
    const context = await fixture(chainLife);
    const owner = startCli('play', ['--content', context.content, '--state', context.state]);
    try {
      await owner.waitForOutput(chainStartText);
      const before = await slotBytes(context.state);
      const denied = await runCli('draw', drawArgs(context.content, context.state, 'blocked', 1));
      expectJsonError(denied, 1, 'STATE_LOCKED');
      expect(await slotBytes(context.state)).toEqual(before);
    } finally {
      expectSuccess(await owner.finish('quit\n'));
    }
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state], 'quit\n'));
  });

  it('does not steal or remove an abandoned lock after its owning process is killed', async () => {
    const context = await fixture(chainLife);
    const owner = startCli('play', ['--content', context.content, '--state', context.state]);
    try {
      await owner.waitForOutput(chainStartText);
    } finally {
      const killed = await owner.kill();
      expect(killed.signal).toBe('SIGKILL');
    }
    const entries = (await readdir(context.state)).sort();
    const before = await slotBytes(context.state);
    const denied = await runCli('draw', drawArgs(context.content, context.state, 'blocked', 1));
    expectJsonError(denied, 1, 'STATE_LOCKED');
    expect((await readdir(context.state)).sort()).toEqual(entries);
    expect(await slotBytes(context.state)).toEqual(before);
  });

  it('leaves corrupt state files intact rather than treating them as an empty draw history', async () => {
    const context = await fixture();
    successJson<DrawJson>(await runCli('draw', drawArgs(context.content, context.state, 'one', 1)));
    successJson<DrawJson>(await runCli('draw', drawArgs(context.content, context.state, 'two', 1)));
    for (const name of ['slot-a.json', 'slot-b.json']) await writeFile(join(context.state, name), `corrupt ${name}`);
    expectJsonError(await runCli('draw', drawArgs(context.content, context.state, 'three', 1)), 1, 'SAVE_CORRUPT');
    for (const name of ['slot-a.json', 'slot-b.json']) expect(await readFile(join(context.state, name), 'utf8')).toBe(`corrupt ${name}`);
  });
});
