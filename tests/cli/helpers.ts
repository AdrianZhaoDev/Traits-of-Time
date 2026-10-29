import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from 'vitest';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import { load } from '../../tools/lib/FileStateStore.js';
import { sha256 } from '../../tools/lib/canonical.js';
import { createContentFixture } from '../helpers/content.js';

export const repositoryDirectory = fileURLToPath(new URL('../../', import.meta.url));
export type CliName = 'validate-content' | 'draw' | 'play' | 'simulate' | 'replay';

export interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** A real process, with output-driven readiness rather than timing-dependent sleeps. */
export function startCli(name: CliName, args: readonly string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', `tools/${name}.ts`, ...args], {
    cwd: repositoryDirectory,
    env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') child.kill('SIGKILL');
  });
  child.stdout.on('data', (text: string) => { stdout += text; });
  child.stderr.on('data', (text: string) => { stderr += text; });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 25_000);
  const finished = once(child, 'close').then(([code, signal]) => ({
    code: code as number | null, signal: signal as NodeJS.Signals | null, stdout, stderr,
  })).finally(() => {
    settled = true;
    clearTimeout(deadline);
  });
  return {
    finished,
    async waitForOutput(text: string): Promise<void> {
      while (!stdout.includes(text)) {
        if (settled) throw new Error(`${name} exited before displaying ${JSON.stringify(text)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        const waiting = new AbortController();
        try {
          await Promise.race([once(child.stdout, 'data', { signal: waiting.signal }), finished]);
        } finally {
          waiting.abort();
        }
      }
    },
    async finish(input = ''): Promise<CliResult> {
      if (!settled && !child.stdin.destroyed) child.stdin.end(input);
      return finished;
    },
    async kill(): Promise<CliResult> {
      if (!settled) child.kill('SIGKILL');
      return finished;
    },
  };
}

export async function runCli(name: CliName, args: readonly string[], input = ''): Promise<CliResult> {
  return startCli(name, args).finish(input);
}

export function expectSuccess(result: CliResult): void {
  expect(result.signal, result.stderr).toBeNull();
  expect(result.code, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
  expect(result.stderr).toBe('');
}

export function successJson<T>(result: CliResult): T {
  expectSuccess(result);
  return JSON.parse(result.stdout) as T;
}

export function expectJsonError(result: CliResult, exitCode: number, code?: string): void {
  expect(result.signal, result.stderr).toBeNull();
  expect(result.code, result.stderr).toBe(exitCode);
  expect(result.stdout).toBe('');
  const error = JSON.parse(result.stderr) as { error: { code: string; message: string } };
  expect(error.error.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
  expect(error.error.message.trim().length).toBeGreaterThan(0);
  if (code !== undefined) expect(error.error.code).toBe(code);
}

/** Each call copies a complete external content package and owns a separate output/state root. */
export function cliFixtures() {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  return async (mutate?: (bundle: ContentBundle) => void) => {
    const content = await createContentFixture(mutate);
    cleanups.push(content.cleanup);
    const root = await mkdtemp(join(tmpdir(), 'configurable-core-cli-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    return { root, content: content.directory, bundle: content.bundle, state: join(root, 'state') };
  };
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function readJsonLines<T>(file: string): Promise<T[]> {
  const text = await readFile(file, 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line) as T);
}

/** Compare persisted bytes, not just the latest reconstructed engine state. */
export async function slotBytes(directory: string): Promise<Record<string, string>> {
  const slots: Record<string, string> = {};
  for (const name of ['slot-a.json', 'slot-b.json']) {
    try {
      slots[name] = await readFile(join(directory, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return slots;
}

export interface SavedLife {
  engine: {
    save_version: 1;
    kind: 'life';
    content_id: string;
    content_version: string;
    content_fingerprint: string;
    revision: number;
    payload: {
      player: {
        age: number;
        start_age: number;
        calendar_year: number;
        identity_id: string;
        highest_identity_id: string;
        attributes: Record<string, number>;
        traits: string[];
        flags: string[];
        achievements: string[];
        chains: { instance_id: string; chain_id: string; status: string }[];
      };
      run: {
        status: string;
        seed: number;
        active_event: unknown;
        prng: unknown;
        dice_results: unknown[];
      };
      logs: { type: string; source_id: string; age: number; calendar_year: number; message: string }[];
    };
  };
  cursor: { input_sequence: number; authorized: boolean; next_child_index: number };
  replay_commands: unknown[];
}

export async function savedLife(directory: string): Promise<SavedLife> {
  const save = await load<SavedLife>(directory);
  expect(save, 'play must persist a real SessionSave before displaying success').not.toBeNull();
  if (save === null) throw new Error('No persisted session');
  expect(save.engine).toMatchObject({ save_version: 1, kind: 'life' });
  return save;
}

export interface ReplayFile {
  replay_version: 1;
  kind: 'life' | 'gacha';
  content_id: string;
  content_version: string;
  content_fingerprint: string;
  seed: number;
  commands: { api: string; commandId: string; args: Record<string, unknown>; expected_result_hash: string; error_code?: string }[];
  expected_final_hash: string;
}

export async function expectReplay(content: string, file: string, engine?: unknown): Promise<ReplayFile> {
  const replay = await readJson<ReplayFile>(file);
  expect(replay.replay_version).toBe(1);
  expect(replay.expected_final_hash).toMatch(/^[a-f0-9]{64}$/);
  if (engine !== undefined) expect(replay.expected_final_hash).toBe(sha256(engine));
  const verified = successJson<{ ok: true; kind: string; final_hash: string }>(
    await runCli('replay', ['--content', content, '--file', file, '--json']),
  );
  expect(verified).toEqual({ ok: true, kind: replay.kind, final_hash: replay.expected_final_hash });
  return replay;
}

/** Keep all references valid while making opening values and lifetime deterministic. */
export function fixedLife(bundle: ContentBundle, lifespan = 20): void {
  bundle.rules.attributes = { min: 0, max: 10, base: 3 };
  bundle.rules.age_bands = [{ id: 'child', min: 9, max: 9, weight: 1, modifiers: {} }];
  bundle.rules.lifespan = { min: lifespan, max: lifespan, min_remaining_years: 3 };
  bundle.rules.events = { per_year: 0, choice_budget_min: 0, choice_budget_max: 0 };
  bundle.era.start_year = 1640;
  for (const entry of [...bundle.regions, ...bundle.castes, ...bundle.traits, ...bundle.era.backgrounds]) {
    entry.modifiers = {};
  }
  for (const event of bundle.events) {
    if (event.trigger.kind === 'opening' || event.trigger.kind === 'random') event.trigger.trigger_probability = 0;
  }
  bundle.events = bundle.events.filter((event) => event.trigger.kind !== 'historical');
}

export const chainOpeningText = '测试开局：九岁开始三年匠作';
export const chainStartText = '开始三年匠作';

export function chainLife(bundle: ContentBundle, lifespan = 20): void {
  fixedLife(bundle, lifespan);
  const opening = bundle.events.find((event) => event.id === 'E_OPEN_SAFE');
  if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening') throw new Error('Missing template opening choice');
  opening.text = chainOpeningText;
  opening.trigger.trigger_probability = 1;
  opening.options = [{
    id: 'start', text: chainStartText, unavailable_text: '任务容量不足', risk: 'normal',
    outcome: {
      text: '已登记三年匠作',
      effects: [{ type: 'attribute_add', attribute: 'wealth', amount: -1 }, { type: 'chain_start', id: 'CH_WORKSHOP' }],
      next_stage_id: null,
    },
  }];
}

export interface DrawItem {
  card_id: string;
  rarity: string;
  draw_index: number;
  forced_pity: boolean;
  pity_before: number;
  pity_after: number;
  conditional_probability: number;
}

export interface DrawJson {
  items: DrawItem[];
  pool_id: string;
  seed: number;
  revision: number;
  content_fingerprint: string;
}
