import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { GameSession } from '../../assets/scripts/application/GameSession.js';
import type { SessionSave } from '../../assets/scripts/application/GameSession.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import type { ContentBundle, Effect, Outcome } from '../../assets/scripts/core/types/content.generated.js';
import { load, save } from '../../tools/lib/FileStateStore.js';
import { sha256 } from '../../tools/lib/canonical.js';
import { loadTemplate } from '../helpers/content.js';

const directories: string[] = [];
const storageFailure = Object.assign(new Error('Injected storage response failure'), { code: 'EIO' });

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function newDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'configurable-core-session-'));
  directories.push(directory);
  return directory;
}

function outcome(effects: Effect[] = [], nextStage: string | null = null): Outcome {
  return { text: 'A deterministic session fixture outcome.', effects, next_stage_id: nextStage };
}

async function peacefulContent(): Promise<ContentBundle> {
  const bundle = await loadTemplate();
  bundle.rules.age_bands = [{ id: 'fixed-nine', min: 9, max: 9, weight: 1, modifiers: {} }];
  bundle.rules.lifespan = { min: 17, max: 17, min_remaining_years: 3 };
  bundle.rules.events = { per_year: 0, choice_budget_min: 0, choice_budget_max: 0 };
  bundle.regions = bundle.regions.map((region) => ({ ...region, weight: Number(region.id === 'R_SHANBEI') }));
  bundle.castes = bundle.castes.map((caste) => ({ ...caste, weight: Number(caste.id === 'C_SOLDIER') }));
  bundle.events = [];
  bundle.chains = [];
  bundle.achievements = [];
  return bundle;
}

async function storyContent(): Promise<ContentBundle> {
  const bundle = await peacefulContent();
  const template = await loadTemplate();
  bundle.chains = template.chains;
  bundle.achievements = template.achievements.filter((achievement) => achievement.id === 'A_PROJECT');
  bundle.events = [
    {
      id: 'E_SESSION_OPEN', text: 'Choose whether to begin a three-year project.',
      trigger: { kind: 'opening', weight: 1, trigger_probability: 1 }, interaction: 'choice',
      options: [
        {
          id: 'locked', text: 'An unavailable route.', unavailable_text: 'Requires impossible wealth.', risk: 'high',
          condition: { op: 'compare', field: 'wealth', comparator: 'gte', value: 999 },
          outcome: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: 1 }]),
        },
        {
          id: 'start', text: 'Begin the project.', unavailable_text: 'Project capacity is full.', risk: 'safe',
          outcome: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: -1 }, { type: 'chain_start', id: 'CH_WORKSHOP' }]),
        },
      ],
    },
    ...template.events.filter((event) => event.trigger.kind === 'chain'),
    {
      id: 'E_SESSION_STAGES', text: 'A two-stage decision during the first project year.',
      trigger: { kind: 'historical', year: 1641, priority: 0 }, interaction: 'choice',
      options: [{
        id: 'attempt', text: 'Try both stages.', unavailable_text: 'Cannot attempt this route.', risk: 'normal',
        outcome: outcome([], 'S1'),
      }],
      stages: [
        {
          id: 'S1', text: 'Confirm the first roll.', check: { attribute: 'intelligence', dc: 14, modifier: 0 },
          success: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: 1 }], 'S2'),
          failure: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: -1 }], 'S2'),
        },
        {
          id: 'S2', text: 'Confirm the second roll.', check: { attribute: 'physique', dc: 14, modifier: 0 },
          success: outcome([{ type: 'attribute_add', attribute: 'prestige', amount: 1 }]),
          failure: outcome([{ type: 'attribute_add', attribute: 'prestige', amount: -1 }]),
        },
      ],
    },
  ];
  return bundle;
}

interface SessionHarness {
  directory: string;
  engine: GameEngine;
  session: GameSession;
  io: {
    attempts: SessionSave[];
    reads: number;
    failure: { at: number; phase: 'before' | 'after' | 'after-unreadable' } | null;
    unreadable: boolean;
  };
}

async function harness(bundle: ContentBundle, directory?: string): Promise<SessionHarness> {
  const root = directory ?? await newDirectory();
  const engine = new GameEngine(bundle, sha256(bundle));
  const io: SessionHarness['io'] = { attempts: [], reads: 0, failure: null, unreadable: false };
  const session = new GameSession(engine, {
    hash: sha256,
    persist: async (value) => {
      io.attempts.push(structuredClone(value));
      const fault = io.failure?.at === io.attempts.length ? io.failure.phase : null;
      if (fault === 'before') throw storageFailure;
      await save(root, value);
      if (fault === 'after-unreadable') io.unreadable = true;
      if (fault === 'after' || fault === 'after-unreadable') throw storageFailure;
    },
    load: async () => {
      io.reads++;
      if (io.unreadable) throw storageFailure;
      return load<SessionSave>(root);
    },
  });
  return { directory: root, engine, session, io };
}

function requireSuccess(result: CommandResult): asserts result is Extract<CommandResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
}

function deterministicState(value: SessionSave) {
  const { player, run } = value.engine.payload;
  return {
    player, prng: run.prng, status: run.status, timeline: run.timeline, year_phase: run.year_phase,
    queue: run.queue, queue_cursor: run.queue_cursor, active_event: run.active_event,
    event_counter: run.event_counter, chain_counter: run.chain_counter,
    processed_history: run.processed_history, cooldowns: run.cooldowns, event_counts: run.event_counts,
    remaining_choice_budget: run.remaining_choice_budget, dice_results: run.dice_results,
    death: run.death, ending: run.ending,
  };
}

async function reachFirstStage(value: SessionHarness): Promise<void> {
  requireSuccess(await value.session.initialize(1640));
  requireSuccess(await value.session.command({ type: 'choose', optionId: 'start' }));
  const history = await value.session.advanceToDecision('reach-history');
  requireSuccess(history);
  expect(history.pending).toMatchObject({ kind: 'option', event_id: 'E_SESSION_STAGES' });
  const stage = await value.session.command({ type: 'choose', optionId: 'attempt' });
  requireSuccess(stage);
  expect(stage.pending).toMatchObject({ kind: 'stage', stage_id: 'S1' });
}

async function playToEnd(value: SessionHarness, mode: 'next' | 'auto'): Promise<void> {
  for (let index = 0; index < 40; index++) {
    const current = value.session.current();
    if (current.state.status === 'ENDED') return;
    let result: CommandResult;
    if (current.pending?.kind === 'option') {
      const option = current.pending.options.find((candidate) => candidate.available);
      if (!option) throw new Error('Story fixture must have an available option');
      result = await value.session.command({ type: 'choose', optionId: option.id });
    } else if (current.pending?.kind === 'stage') {
      result = await value.session.command({ type: 'stage' });
    } else if (mode === 'auto') {
      result = await value.session.advanceToDecision(`journey-${index}`);
    } else {
      result = await value.session.command({ type: 'next' });
    }
    requireSuccess(result);
  }
  throw new Error('Story fixture did not end within 40 real commands');
}

describe('GameSession: real engine commands, decisions and durable cursors', () => {
  it('persists initialization and its result hash without adding session data to the core save', async () => {
    const value = await harness(await storyContent());
    const initialized = await value.session.initialize(1640);
    requireSuccess(initialized);
    expect(initialized.state.player).toMatchObject({ age: 9, calendar_year: 1640 });
    expect(initialized.pending).toMatchObject({ kind: 'option', event_id: 'E_SESSION_OPEN' });
    expect(value.io.attempts).toHaveLength(1);
    const stored = await load<SessionSave>(value.directory);
    expect(stored).toEqual(value.session.exportSave());
    expect(stored!.engine).toEqual(value.engine.exportSave());
    expect(stored!.replay_commands).toHaveLength(1);
    expect(stored!.replay_commands[0].expected_result_hash).toBe(sha256(initialized));
    expect(stored!.cursor).toMatchObject({ authorized: false });
    expect(stored!.engine).not.toHaveProperty('cursor');
    expect(stored!.engine.payload.run).not.toHaveProperty('replay_commands');
    expect(value.session.current()).toEqual({ state: initialized.state, pending: initialized.pending });
  });

  it('produces the same player, queue, RNG, dice, chains and ending using next or auto', async () => {
    const bundle = await storyContent();
    const manual = await harness(bundle);
    const automatic = await harness(bundle);
    requireSuccess(await manual.session.initialize(1640));
    requireSuccess(await automatic.session.initialize(1640));
    await playToEnd(manual, 'next');
    await playToEnd(automatic, 'auto');
    expect(deterministicState(automatic.session.exportSave())).toEqual(deterministicState(manual.session.exportSave()));
    expect(automatic.engine.generateEndingReport()).toEqual(manual.engine.generateEndingReport());
    expect(automatic.session.current().state).toMatchObject({
      status: 'ENDED', player: { age: 17, calendar_year: 1648, identity_id: 'I_ARTISAN' },
    });
    expect(automatic.engine.exportSave().payload.player.flags).toContain('workshop_complete');
    expect(automatic.engine.exportSave().payload.player.achievements).toContain('A_PROJECT');
    expect(automatic.engine.exportSave().payload.run.dice_results).toHaveLength(2);
    expect(automatic.engine.generateEndingReport()).toMatchObject({ end_reason: 'death', death_id: 'D_OLD_AGE', years_played: 8 });
  });

  it('saves every child year in order and returns at a choice without choosing or rolling', async () => {
    const value = await harness(await storyContent());
    requireSuccess(await value.session.initialize(1640));
    requireSuccess(await value.session.command({ type: 'choose', optionId: 'start' }));
    const before = value.session.exportSave();
    const result = await value.session.advanceToDecision('project-year');
    requireSuccess(result);
    expect(result.state.player).toMatchObject({ age: 10, calendar_year: 1641 });
    expect(result.pending).toMatchObject({ kind: 'option', event_id: 'E_SESSION_STAGES' });
    expect(value.engine.exportSave().payload.run.dice_results).toHaveLength(0);
    const after = value.session.exportSave();
    expect(after.replay_commands.slice(before.replay_commands.length).map((command) => command.commandId)).toEqual(['project-year:0']);
    expect(after.cursor).toMatchObject({ parent_command_id: 'project-year', next_child_index: 1, authorized: false });
    expect(await load<SessionSave>(value.directory)).toEqual(after);
  });

  it('requires a separate command for each stage and restores the next real roll exactly', async () => {
    const bundle = await storyContent();
    const continuous = await harness(bundle);
    await reachFirstStage(continuous);
    const first = await continuous.session.command({ type: 'stage' });
    requireSuccess(first);
    expect(first.pending).toMatchObject({ kind: 'stage', stage_id: 'S2' });
    expect(continuous.engine.exportSave().payload.run.dice_results).toHaveLength(1);
    const saved = await load<SessionSave>(continuous.directory);
    expect(saved).not.toBeNull();
    const restored = await harness(bundle, continuous.directory);
    restored.session.restoreSave(saved!);
    expect(restored.io.attempts).toHaveLength(0);
    expect(restored.session.current()).toEqual(continuous.session.current());
    const expected = await continuous.session.command({ type: 'stage' });
    const actual = await restored.session.command({ type: 'stage' });
    requireSuccess(expected);
    requireSuccess(actual);
    expect(actual).toEqual(expected);
    expect(restored.engine.exportSave()).toEqual(continuous.engine.exportSave());
    expect(restored.engine.exportSave().payload.run.dice_results).toHaveLength(2);
    expect(actual.state.player.calendar_year).toBe(1641);
    expect(actual.pending).toBeNull();
  });

  it.each(['identity', 'achievement'] as const)('stops at the first new %s in READY rather than advancing to death', async (important) => {
    const bundle = await peacefulContent();
    bundle.events = [{
      id: 'E_IMPORTANT', text: 'An important automatic change.',
      trigger: { kind: 'historical', year: 1642, priority: 0 }, interaction: 'automatic',
      outcome: outcome(important === 'identity'
        ? [{ type: 'identity_set', id: 'I_ARTISAN' }]
        : [{ type: 'flag_add', id: 'milestone' }]),
    }];
    if (important === 'achievement') bundle.achievements = [{
      id: 'A_MILESTONE', name: 'Milestone', text: 'An attained milestone.',
      condition: { op: 'has', collection: 'flags', id: 'milestone' }, priority: 1, retirable: true,
    }];
    const value = await harness(bundle);
    requireSuccess(await value.session.initialize(1640));
    const result = await value.session.advanceToDecision('important');
    requireSuccess(result);
    expect(result.state).toMatchObject({ status: 'READY', player: { age: 11, calendar_year: 1642 } });
    expect(result.pending).toBeNull();
    if (important === 'identity') expect(result.state.player.identity_id).toBe('I_ARTISAN');
    else expect(result.state.player.achievements).toContain('A_MILESTONE');
    expect(value.session.exportSave().cursor.authorized).toBe(false);
    const children = value.session.exportSave().replay_commands.slice(1).map((command) => command.commandId);
    expect(children).toEqual(['important:0', 'important:1']);
    const distinctYears = [...new Set(value.io.attempts.map((attempt) => attempt.engine.payload.player.calendar_year))];
    expect(distinctYears).toEqual([1640, 1641, 1642]);
    expect(await load<SessionSave>(value.directory)).toEqual(value.session.exportSave());
  });

  it('does not execute next or auto through a pending choice and persists rejected manual commands for replay', async () => {
    const value = await harness(await storyContent());
    requireSuccess(await value.session.initialize(1640));
    const before = value.engine.exportSave();
    const rejected = await value.session.command({ type: 'next' });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    expect(value.engine.exportSave()).toEqual(before);
    const latest = value.session.exportSave().replay_commands.at(-1)!;
    expect(latest).toMatchObject({ error_code: 'INVALID_STATE', expected_result_hash: sha256(rejected) });
    expect(await load<SessionSave>(value.directory)).toEqual(value.session.exportSave());
    const auto = await value.session.advanceToDecision('pending-auto');
    expect(auto).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    expect(value.engine.exportSave()).toEqual(before);
    expect(value.session.current().pending).toMatchObject({ kind: 'option', event_id: 'E_SESSION_OPEN' });
  });

  it('does not spend resources for a locked option and does not reuse manual IDs after restore', async () => {
    const bundle = await storyContent();
    const value = await harness(bundle);
    requireSuccess(await value.session.initialize(1640));
    const initial = value.session.exportSave();
    const rejected = await value.session.command({ type: 'choose', optionId: 'locked' });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'OPTION_UNAVAILABLE' } });
    expect(value.engine.exportSave()).toEqual(initial.engine);
    const stored = (await load<SessionSave>(value.directory))!;
    expect(stored.cursor.input_sequence).toBe(initial.cursor.input_sequence + 1);
    const rejectedId = stored.replay_commands.at(-1)!.commandId;
    expect(rejectedId).toMatch(/^life-input:\d+$/);
    expect(stored.replay_commands.at(-1)).toMatchObject({
      commandId: rejectedId, error_code: 'OPTION_UNAVAILABLE', expected_result_hash: sha256(rejected),
    });
    const restored = await harness(bundle, value.directory);
    restored.session.restoreSave(stored);
    requireSuccess(await restored.session.command({ type: 'choose', optionId: 'start' }));
    const after = restored.session.exportSave();
    const acceptedId = after.replay_commands.at(-1)!.commandId;
    expect(acceptedId).toMatch(/^life-input:\d+$/);
    expect(Number(acceptedId.slice('life-input:'.length))).toBeGreaterThan(Number(rejectedId.slice('life-input:'.length)));
    expect(after.cursor.input_sequence).toBe(stored.cursor.input_sequence + 1);
    expect(after.replay_commands.filter((command) => command.commandId === rejectedId)).toHaveLength(1);
    expect(after.engine.payload.player.chains).toHaveLength(1);
  });

  it('persists a successful retirement and leaves an ended save ended on restart', async () => {
    const bundle = await peacefulContent();
    bundle.achievements = [{
      id: 'A_READY', name: 'Ready', text: 'Already eligible to retire.',
      condition: { op: 'compare', field: 'age', comparator: 'gte', value: 9 }, priority: 1, retirable: true,
    }];
    const value = await harness(bundle);
    requireSuccess(await value.session.initialize(1640));
    const result = await value.session.command({ type: 'retire' });
    requireSuccess(result);
    expect(result.state.status).toBe('ENDED');
    expect(value.engine.generateEndingReport()).toMatchObject({ end_reason: 'retired', death_id: null, years_played: 0 });
    const restored = await harness(bundle, value.directory);
    restored.session.restoreSave((await load<SessionSave>(value.directory))!);
    expect(restored.session.current()).toEqual(value.session.current());
    expect(restored.io.attempts).toHaveLength(0);
    expect(restored.engine.generateEndingReport()).toEqual(value.engine.generateEndingReport());
  });
});

describe('GameSession: uncertain persistence outcomes and restart safety', () => {
  it.each(['before', 'after'] as const)('rereads after a %s-commit failure and stops after the first auto child', async (phase) => {
    const bundle = await peacefulContent();
    const value = await harness(bundle);
    requireSuccess(await value.session.initialize(1640));
    const before = value.session.exportSave();
    value.io.failure = { at: value.io.attempts.length + 1, phase };
    await expect(value.session.advanceToDecision('failed-auto')).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    expect(value.io.reads).toBe(1);
    expect(value.io.attempts).toHaveLength(2);
    const expectedAge = phase === 'after' ? 10 : 9;
    expect(value.session.current().state.player.age).toBe(expectedAge);
    expect(value.session.exportSave().cursor.authorized).toBe(false);
    const stored = (await load<SessionSave>(value.directory))!;
    expect(stored.engine).toEqual(value.engine.exportSave());
    if (phase === 'before') {
      expect(value.engine.exportSave()).toEqual(before.engine);
      expect(stored.replay_commands).toEqual(before.replay_commands);
    } else {
      expect(stored.replay_commands.at(-1)!.commandId).toBe('failed-auto:0');
      expect(stored.cursor.next_child_index).toBe(1);
      const control = new GameEngine(bundle, sha256(bundle));
      requireSuccess(control.initGame({ seed: 1640 }));
      requireSuccess(control.nextYear('failed-auto:0'));
      expect(value.engine.exportSave()).toEqual(control.exportSave());
    }
  });

  it('restores the last committed child paused and resumes with the next index only after new authorization', async () => {
    const bundle = await peacefulContent();
    const value = await harness(bundle);
    requireSuccess(await value.session.initialize(1640));
    value.io.failure = { at: value.io.attempts.length + 2, phase: 'before' };
    await expect(value.session.advanceToDecision('resumable')).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    const stored = (await load<SessionSave>(value.directory))!;
    expect(stored.engine.payload.player).toMatchObject({ age: 10, calendar_year: 1641 });
    expect(stored.cursor.next_child_index).toBe(1);
    const restored = await harness(bundle, value.directory);
    restored.session.restoreSave(stored);
    await nextTurn();
    expect(restored.session.exportSave().engine).toEqual(stored.engine);
    expect(restored.session.exportSave().cursor.authorized).toBe(false);
    expect(restored.io.attempts).toHaveLength(0);
    expect(restored.io.reads).toBe(0);
    const ended = await restored.session.advanceToDecision('resumable');
    requireSuccess(ended);
    expect(ended.state.status).toBe('ENDED');
    expect(restored.io.attempts[0].engine.payload.player).toMatchObject({ age: 11, calendar_year: 1642 });
    const children = restored.session.exportSave().replay_commands.slice(1).map((command) => command.commandId);
    expect(children).toEqual(Array.from({ length: 8 }, (_, index) => `resumable:${index}`));
    expect(new Set(children).size).toBe(children.length);
  });

  it('rolls a failed-before-commit stage back including its RNG, then allows a safe retry after restart', async () => {
    const bundle = await storyContent();
    const value = await harness(bundle);
    await reachFirstStage(value);
    const before = value.session.exportSave();
    value.io.failure = { at: value.io.attempts.length + 1, phase: 'before' };
    await expect(value.session.command({ type: 'stage' })).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    expect(value.engine.exportSave()).toEqual(before.engine);
    expect(value.session.current().pending).toMatchObject({ kind: 'stage', stage_id: 'S1' });
    expect(value.io.reads).toBe(1);
    const restored = await harness(bundle, value.directory);
    restored.session.restoreSave((await load<SessionSave>(value.directory))!);
    const control = await harness(bundle);
    control.session.restoreSave(before);
    const expected = await control.session.command({ type: 'stage' });
    const actual = await restored.session.command({ type: 'stage' });
    requireSuccess(expected);
    requireSuccess(actual);
    expect(actual).toEqual(expected);
    expect(restored.engine.exportSave()).toEqual(control.engine.exportSave());
    expect(restored.engine.exportSave().payload.run.dice_results).toHaveLength(1);
  });

  it('adopts a committed stage after response loss rather than consuming its dice or effects twice', async () => {
    const bundle = await storyContent();
    const value = await harness(bundle);
    await reachFirstStage(value);
    const before = value.session.exportSave();
    const control = await harness(bundle);
    control.session.restoreSave(before);
    requireSuccess(await control.session.command({ type: 'stage' }));
    value.io.failure = { at: value.io.attempts.length + 1, phase: 'after' };
    await expect(value.session.command({ type: 'stage' })).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    expect(value.io.reads).toBe(1);
    expect(value.engine.exportSave()).toEqual(control.engine.exportSave());
    expect(value.session.current().pending).toMatchObject({ kind: 'stage', stage_id: 'S2' });
    expect(value.engine.exportSave().payload.run.dice_results).toHaveLength(1);
    const stored = (await load<SessionSave>(value.directory))!;
    expect(stored.engine).toEqual(control.engine.exportSave());
    expect(stored.cursor.input_sequence).toBe(before.cursor.input_sequence + 1);
    const restored = await harness(bundle, value.directory);
    restored.session.restoreSave(stored);
    const expected = await control.session.command({ type: 'stage' });
    const actual = await restored.session.command({ type: 'stage' });
    requireSuccess(expected);
    requireSuccess(actual);
    expect(actual).toEqual(expected);
    expect(restored.engine.exportSave()).toEqual(control.engine.exportSave());
    expect(restored.engine.exportSave().payload.run.dice_results).toHaveLength(2);
  });

  it('halts without retrying or removing files when both the response and recovery read fail', async () => {
    const value = await harness(await peacefulContent());
    requireSuccess(await value.session.initialize(1640));
    value.io.failure = { at: value.io.attempts.length + 1, phase: 'after-unreadable' };
    await expect(value.session.advanceToDecision('uncertain')).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    expect(value.io.reads).toBe(1);
    expect(value.io.attempts).toHaveLength(2);
    expect(value.session.exportSave().cursor.authorized).toBe(false);
    const names = (await readdir(value.directory)).sort();
    expect(names).toEqual(['slot-a.json', 'slot-b.json']);
    const bytes = await Promise.all(names.map((name) => readFile(join(value.directory, name), 'utf8')));
    const actual = (await load<SessionSave>(value.directory))!;
    expect(actual.engine.payload.player.age).toBe(10);
    expect(actual.replay_commands.at(-1)!.commandId).toBe('uncertain:0');
    await nextTurn();
    expect(value.io.attempts).toHaveLength(2);
    expect(await Promise.all(names.map((name) => readFile(join(value.directory, name), 'utf8')))).toEqual(bytes);
  });

  it('does not resolve a successful manual command before the real persistence promise completes', async () => {
    const bundle = await peacefulContent();
    const directory = await newDirectory();
    const engine = new GameEngine(bundle, sha256(bundle));
    const barrier = new EventEmitter();
    const gate = once(barrier, 'release');
    const pendingPersist = once(barrier, 'entered');
    let hold = false;
    const session = new GameSession(engine, {
      hash: sha256,
      load: () => load<SessionSave>(directory),
      persist: async (value) => {
        if (hold) {
          barrier.emit('entered');
          await gate;
        }
        await save(directory, value);
      },
    });
    requireSuccess(await session.initialize(1640));
    hold = true;
    let settled = false;
    const command = session.command({ type: 'next' });
    void command.then(() => { settled = true; }, () => { settled = true; });
    try {
      await pendingPersist;
      await Promise.resolve();
      expect(settled).toBe(false);
      expect((await load<SessionSave>(directory))!.engine.payload.player.age).toBe(9);
    } finally {
      barrier.emit('release');
    }
    const result = await command;
    requireSuccess(result);
    expect(settled).toBe(true);
    expect((await load<SessionSave>(directory))!.engine).toEqual(engine.exportSave());
    expect(result.state.player.age).toBe(10);
  });
});

describe('GameSession.restoreSave: strict session cursors', () => {
  const invalid: Array<{ name: string; corrupt: (value: SessionSave) => void }> = [
    { name: 'negative child index', corrupt: (value) => { Object.assign(value.cursor, { next_child_index: -1 }); } },
    { name: 'fractional child index', corrupt: (value) => { Object.assign(value.cursor, { next_child_index: 1.5 }); } },
    { name: 'unsafe child index', corrupt: (value) => { Object.assign(value.cursor, { next_child_index: Number.MAX_SAFE_INTEGER + 1 }); } },
    { name: 'negative input sequence', corrupt: (value) => { Object.assign(value.cursor, { input_sequence: -1 }); } },
    { name: 'fractional input sequence', corrupt: (value) => { Object.assign(value.cursor, { input_sequence: 0.5 }); } },
    { name: 'unsafe input sequence', corrupt: (value) => { Object.assign(value.cursor, { input_sequence: Number.MAX_SAFE_INTEGER + 1 }); } },
    { name: 'nonboolean authorization', corrupt: (value) => { Object.assign(value.cursor, { authorized: 'true' }); } },
    { name: 'nonstring parent ID', corrupt: (value) => { Object.assign(value.cursor, { parent_command_id: 42 }); } },
    { name: 'missing cursor', corrupt: (value) => { Reflect.deleteProperty(value, 'cursor'); } },
    { name: 'nonarray replay commands', corrupt: (value) => { Object.assign(value, { replay_commands: {} }); } },
  ];

  it.each(invalid)('rejects $name without replacing the engine or current cursor', async ({ corrupt }) => {
    const value = await harness(await peacefulContent());
    requireSuccess(await value.session.initialize(1640));
    const before = value.session.exportSave();
    const malformed = structuredClone(before);
    corrupt(malformed);
    expect(() => value.session.restoreSave(malformed)).toThrow();
    expect(value.session.exportSave()).toEqual(before);
    expect(value.io.attempts).toHaveLength(1);
    expect(await load<SessionSave>(value.directory)).toEqual(before);
  });
});
