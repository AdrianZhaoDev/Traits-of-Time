import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cliFixtures, expectJsonError, expectSuccess, fixedLife, readJson, runCli, savedLife,
  slotBytes, successJson, type CliName, type DrawJson, type ReplayFile,
} from './helpers.js';

const fixture = cliFixtures();

const invalidDrawCases = [
  { name: 'missing pool', pool: undefined, count: '1', command: 'id' },
  { name: 'missing count', pool: 'POOL_BASIC', count: undefined, command: 'id' },
  { name: 'missing command ID', pool: 'POOL_BASIC', count: '1', command: undefined },
  { name: 'zero count', pool: 'POOL_BASIC', count: '0', command: 'id' },
  { name: 'negative count', pool: 'POOL_BASIC', count: '-1', command: 'id' },
  { name: 'fractional count', pool: 'POOL_BASIC', count: '1.5', command: 'id' },
  { name: 'trailing numeric junk', pool: 'POOL_BASIC', count: '2cards', command: 'id' },
  { name: 'unsafe count', pool: 'POOL_BASIC', count: '9007199254740992', command: 'id' },
  { name: 'negative seed', pool: 'POOL_BASIC', count: '1', command: 'id', seed: '-1' },
  { name: 'overflowing seed', pool: 'POOL_BASIC', count: '1', command: 'id', seed: '4294967296' },
  { name: 'fractional seed', pool: 'POOL_BASIC', count: '1', command: 'id', seed: '1.5' },
  { name: 'unknown option', pool: 'POOL_BASIC', count: '1', command: 'id', extra: ['--invented-flag'] },
  { name: 'unexpected positional input', pool: 'POOL_BASIC', count: '1', command: 'id', extra: ['unrequested'] },
];

describe('CLI argument errors: exit two before mutating state', () => {
  it.each(invalidDrawCases)('draw rejects $name', async ({ pool, count, command, seed, extra }) => {
    const context = await fixture();
    const args = ['--content', context.content, '--state', context.state, '--json'];
    if (pool !== undefined) args.push('--pool', pool);
    if (count !== undefined) args.push('--count', count);
    if (command !== undefined) args.push('--command-id', command);
    if (seed !== undefined) args.push('--seed', seed);
    args.push(...(extra ?? []));
    expectJsonError(await runCli('draw', args), 2);
    expect(await readdir(context.root)).toEqual([]);
  });

  it.each([
    { name: 'missing runs', args: [] },
    { name: 'zero runs', args: ['--runs', '0'] },
    { name: 'fractional runs', args: ['--runs', '1.5'] },
    { name: 'unknown mode', args: ['--runs', '1', '--mode', 'cards'] },
    { name: 'unknown strategy', args: ['--runs', '1', '--strategy', 'random'] },
    { name: 'life mode with pool', args: ['--runs', '1', '--mode', 'life', '--pool', 'POOL_BASIC'] },
    { name: 'life mode with draws-per-run', args: ['--runs', '1', '--draws-per-run', '3'] },
    { name: 'draw mode without pool', args: ['--runs', '1', '--mode', 'draw', '--draws-per-run', '3'] },
    { name: 'draw mode without draw count', args: ['--runs', '1', '--mode', 'draw', '--pool', 'POOL_BASIC'] },
    { name: 'draw mode with zero draw count', args: ['--runs', '1', '--mode', 'draw', '--pool', 'POOL_BASIC', '--draws-per-run', '0'] },
    { name: 'draw mode with a life strategy', args: ['--runs', '1', '--mode', 'draw', '--pool', 'POOL_BASIC', '--draws-per-run', '1', '--strategy', 'risky'] },
    { name: 'seed range overflow', args: ['--runs', '2', '--seed', '4294967295'] },
  ])('simulate rejects $name', async ({ args }) => {
    const context = await fixture();
    const rejected = await runCli('simulate', ['--content', context.content, '--out', join(context.root, 'invalid-output'), ...args]);
    expect(rejected.signal).toBeNull();
    expect(rejected.code, rejected.stderr).toBe(2);
    expect(await readdir(context.root)).toEqual([]);
  });

  it.each([
    { name: 'simulate', args: ['--runs', '1'] },
    { name: 'replay', args: ['--json'] },
    { name: 'play', args: ['--seed', 'not-a-seed'] },
    { name: 'validate-content', args: ['--json', '--unknown'] },
  ] as { name: CliName; args: string[] }[])('$name rejects its missing or malformed required parameter', async ({ name, args }) => {
    const context = await fixture();
    const result = await runCli(name, ['--content', context.content, ...args]);
    expect(result.signal).toBeNull();
    expect(result.code, result.stderr).toBe(2);
    if (args.includes('--json')) expectJsonError(result, 2);
    expect(await readdir(context.root)).toEqual([]);
  });

  it('accepts a seed range ending at the uint32 upper boundary and reports both endpoints', async () => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    const output = join(context.root, 'max-seed');
    expectSuccess(await runCli('simulate', [
      '--content', context.content, '--runs', '2', '--seed', '4294967294', '--out', output,
    ]));
    expect(await readJson(join(output, 'summary.json'))).toMatchObject({ seed: 4294967294, seed_end: 4294967295, runs: 2, success: 2, failed: 0 });
  });

  it('rejects too many nonreplacement cards before creating a partial report', async () => {
    const context = await fixture();
    const rejected = await runCli('simulate', [
      '--content', context.content, '--mode', 'draw', '--pool', 'POOL_UNIQUE', '--draws-per-run', '4',
      '--runs', '2', '--out', join(context.root, 'oversized'),
    ]);
    expect(rejected.code).toBe(1);
    expect(rejected.stderr).toContain('INSUFFICIENT_CANDIDATES');
    expect(await readdir(context.root)).toEqual([]);
  });
});

describe('CLI output boundaries: content remains read-only', () => {
  it('rejects draw state inside the imported package without adding files to the package', async () => {
    const context = await fixture();
    const before = (await readdir(context.content)).sort();
    const manifest = await readFile(join(context.content, 'manifest.json'), 'utf8');
    const result = await runCli('draw', [
      '--content', context.content, '--state', join(context.content, 'forbidden-state'),
      '--pool', 'POOL_BASIC', '--count', '1', '--command-id', 'not-allowed', '--json',
    ]);
    expectJsonError(result, 2);
    expect((await readdir(context.content)).sort()).toEqual(before);
    expect(await readFile(join(context.content, 'manifest.json'), 'utf8')).toBe(manifest);
  });

  it('resolves symlink parents before allowing a state directory outside the apparent package path', async () => {
    const context = await fixture();
    const alias = join(context.root, 'content-alias');
    await symlink(context.content, alias, 'dir');
    const before = (await readdir(context.content)).sort();
    expectJsonError(await runCli('draw', [
      '--content', context.content, '--state', join(alias, 'forbidden-state'),
      '--pool', 'POOL_BASIC', '--count', '1', '--command-id', 'not-allowed', '--json',
    ]), 2);
    expect((await readdir(context.content)).sort()).toEqual(before);
  });

  it.each(['report', 'replay'] as const)('rejects a %s destination inside the content package', async (kind) => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    const before = (await readdir(context.content)).sort();
    const result = kind === 'report'
      ? await runCli('simulate', ['--content', context.content, '--runs', '1', '--out', join(context.content, 'report')])
      : await runCli('play', [
        '--content', context.content, '--state', context.state, '--export-replay', join(context.content, 'replay.json'),
      ], 'quit\n');
    expect(result.code).toBe(2);
    expect((await readdir(context.content)).sort()).toEqual(before);
    expect(await readdir(context.root)).toEqual([]);
  });

  it('refuses explicit seed changes for a persisted life, then resumes with the stored seed when omitted', async () => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    expectSuccess(await runCli('play', ['--content', context.content, '--seed', '32', '--state', context.state], 'quit\n'));
    const before = await slotBytes(context.state);
    const refused = await runCli('play', ['--content', context.content, '--seed', '33', '--state', context.state], 'quit\n');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('SEED_MISMATCH');
    expect(await slotBytes(context.state)).toEqual(before);
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state], 'quit\n'));
    expect((await savedLife(context.state)).engine.payload.run.seed).toBe(32);
  });
});

describe('validate-content and replay: structured real failures', () => {
  it('validates an external package with the same fingerprint used by draw', async () => {
    const context = await fixture();
    const validated = successJson<{ ok: boolean; content_id: string; content_version: string; fingerprint: string }>(
      await runCli('validate-content', ['--content', context.content, '--json']),
    );
    const drawn = successJson<DrawJson>(await runCli('draw', [
      '--content', context.content, '--state', context.state, '--pool', 'POOL_BASIC',
      '--count', '1', '--command-id', 'fingerprint', '--json',
    ]));
    expect(validated).toEqual({
      ok: true, content_id: context.bundle.manifest.content_id,
      content_version: context.bundle.manifest.content_version, fingerprint: drawn.content_fingerprint,
    });
  });

  it('keeps malformed-package diagnostics on stderr with a file, JSON pointer and exact issue code', async () => {
    const context = await fixture();
    await writeFile(join(context.content, context.bundle.manifest.files.cards), '[ malformed JSON');
    const result = await runCli('validate-content', ['--content', context.content, '--json']);
    expectJsonError(result, 1);
    const error = JSON.parse(result.stderr) as { error: { issues: { file: string; path: string; code: string }[] } };
    expect(error.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: context.bundle.manifest.files.cards, path: '', code: 'JSON_PARSE' }),
    ]));
  });

  it('rejects a missing content package as a runtime failure rather than a usage error or a new default package', async () => {
    const context = await fixture();
    const rejected = await runCli('validate-content', ['--content', join(context.root, 'does-not-exist'), '--json']);
    expectJsonError(rejected, 1);
    expect(await readdir(context.root)).toEqual([]);
  });

  it('detects the first changed replay result and a changed final hash without overwriting evidence', async () => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    const original = join(context.root, 'source.json');
    expectSuccess(await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', original,
    ], 'next\nquit\n'));
    const replay = await readJson<ReplayFile>(original);
    const diverged = structuredClone(replay);
    diverged.commands[1]!.expected_result_hash = '0'.repeat(64);
    const badCommand = join(context.root, 'bad-command.json');
    await writeFile(badCommand, JSON.stringify(diverged));
    const result = await runCli('replay', ['--content', context.content, '--file', badCommand, '--json']);
    expectJsonError(result, 1, 'REPLAY_DIVERGED');
    const error = JSON.parse(result.stderr) as { error: { command_index: number } };
    expect(error.error.command_index).toBe(1);
    expect(await readJson(badCommand)).toEqual(diverged);

    const badFinal = join(context.root, 'bad-final.json');
    const finalOnly = { ...replay, expected_final_hash: '0'.repeat(64) };
    await writeFile(badFinal, JSON.stringify(finalOnly));
    expectJsonError(await runCli('replay', ['--content', context.content, '--file', badFinal, '--json']), 1, 'REPLAY_DIVERGED');
    expect(await readJson(original)).toEqual(replay);
  });

  it('rejects a replay against changed content even when its content ID and version are unchanged', async () => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    const replayFile = join(context.root, 'life.json');
    expectSuccess(await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', replayFile,
    ], 'quit\n'));
    const cardsFile = join(context.content, context.bundle.manifest.files.cards);
    const cards = JSON.parse(await readFile(cardsFile, 'utf8')) as { name: string }[];
    cards[0]!.name += '（正文已替换）';
    await writeFile(cardsFile, JSON.stringify(cards));
    expectJsonError(await runCli('replay', ['--content', context.content, '--file', replayFile, '--json']), 1, 'CONTENT_MISMATCH');
  });

  it('does not accept an existing empty report directory as permission to overwrite', async () => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    const output = join(context.root, 'already-there');
    await mkdir(output);
    const failed = await runCli('simulate', ['--content', context.content, '--runs', '1', '--out', output]);
    expect(failed.code).toBe(1);
    expect(await readdir(output)).toEqual([]);
  });
});
