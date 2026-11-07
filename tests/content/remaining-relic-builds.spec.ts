import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { conditionContext, evaluateCondition } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import type { LogEntry } from '../../assets/scripts/core/types/schema.js';

type Success = Extract<CommandResult, { ok: true }>;
const fingerprint = 'b'.repeat(64);
let production: ContentBundle;
beforeAll(async () => { production = (await loadContent('assets/resources/data/ming_end')).bundle; });

const builds = [
  { key: 'CALCULATOR', card: 'CARD_MODERN_CALCULATOR', chain: 'CHAIN_MOD_CALCULATOR_FINANCE', prefix: 'F_MOD_CALCULATOR_',
    opening: ['E_MOD_CALCULATOR_OPEN_CHILD', 'E_MOD_CALCULATOR_OPEN_YOUTH', 'E_MOD_CALCULATOR_OPEN_ADULT', 'E_MOD_CALCULATOR_RETIRED'],
    main: ['E_MOD_CALCULATOR_CORRUPT', 'E_MOD_CALCULATOR_SUPPLY', 'E_MOD_CALCULATOR_MINISTRY', 'E_MOD_CALCULATOR_SSR_TREASURY'],
    fast: ['E_MOD_CALCULATOR_FORTUNE', 'E_MOD_CALCULATOR_TAX', 'E_MOD_CALCULATOR_SIEGE'], breakthrough: 'E_MOD_CALCULATOR_BREAKTHROUGH',
    career: 'E_START_IMPERIAL_EXAM', careerOption: 'calculator_study', critical: 'A_MOD_CALCULATOR_PERFECT_TREASURY',
    trap: 'E_MOD_CALCULATOR_MISUSE', death: 'D_MOD_CALCULATOR_HERESY_FIRE', deathFlag: 'F_MOD_CALCULATOR_DEATH_MISUSE', deathAchievement: 'A_MOD_CALCULATOR_UPSIDE_DOWN' },
  { key: 'GLUE', card: 'CARD_MODERN_GLUE', chain: 'CHAIN_MOD_GLUE_ARTISAN', prefix: 'F_MOD_GLUE_',
    opening: ['E_OPEN_GLUE_CHILD_FEEDBACK', 'E_MOD_SWISS_SALT', 'E_MOD_GLUE_MAGISTRATE_BOOTS', 'E_MOD_SWISS_CORAL'],
    main: ['E_MOD_GLUE_PORCELAIN_MASTER', 'E_MOD_SWISS_CHIEF', 'E_MOD_SWISS_GUNSMITH', 'E_MOD_SWISS_BOOK'],
    fast: ['E_MOD_GLUE_SIEGE_DEFENSE', 'E_MOD_GLUE_SHIP_LEAK', 'E_MOD_SWISS_TUNNEL'], breakthrough: 'E_MOD_GLUE_CRAFT_CHALLENGE',
    career: 'E_MOD_SWISS_MUSKET', careerOption: 'glue_army', critical: 'A_MOD_GLUE_REPAIR_DYNASTY',
    trap: 'E_MOD_SWISS_MISUSE', death: 'D_MOD_SWISS_BLADE_SEVER', deathFlag: 'F_MOD_GLUE_DEATH_KNIFE', deathAchievement: 'A_MOD_GLUE_FINGER_BOND' },
  { key: 'LIGHTER', card: 'CARD_MODERN_LIGHTER', chain: 'CHAIN_MOD_LIGHTER_VETERAN', prefix: 'F_MOD_LIGHTER_',
    opening: ['E_OPEN_OIL_CHILD_FEEDBACK', 'E_MOD_LIGHTER_BEARD', 'E_MOD_LIGHTER_SMOKE', 'E_MOD_LIGHTER_OLD_WHEEL'],
    main: ['E_MOD_OIL_FOLK_DOCTOR', 'E_MOD_LIGHTER_ARMY_REFORM', 'E_MOD_LIGHTER_PALACE_PRESENT', 'E_MOD_LIGHTER_DYNASTY_MIRACLE'],
    fast: ['E_MOD_LIGHTER_BEACON_MISSION', 'E_MOD_LIGHTER_CANNON_DEFENSE', 'E_MOD_LIGHTER_NIGHT_RAID'], breakthrough: 'E_MOD_LIGHTER_BREAKTHROUGH',
    career: 'E_MOD_OIL_HEATSTROKE_RESCUE', careerOption: 'relic_lighter', critical: 'A_MOD_LIGHTER_REWRITE_DYNASTY',
    trap: 'E_MOD_LIGHTER_MISUSE', death: 'D_MOD_LIGHTER_GAS_BURST', deathFlag: 'F_MOD_LIGHTER_DEATH_FIRE', deathAchievement: 'A_MOD_LIGHTER_WILD_BEAST' },
  { key: 'BOWL', card: 'CARD_NATIVE_BOWL', chain: 'CHAIN_NAT_BOWL_TYCOON', prefix: 'F_NAT_BOWL_',
    opening: ['E_NAT_BOWL_OPEN_CHILD', 'E_NAT_BOWL_OPEN_YOUTH', 'E_NAT_BOWL_OPEN_ADULT', 'E_NAT_BOWL_OPEN_ELDER'],
    main: ['E_NAT_BOWL_STALL', 'E_NAT_BOWL_SHOP', 'E_NAT_BOWL_STREET'],
    fast: ['E_NAT_BOWL_FAST_PRICES', 'E_NAT_BOWL_FAST_STALL', 'E_NAT_BOWL_FAST_REPAIR'], breakthrough: 'E_NAT_BOWL_BREAKTHROUGH',
    career: 'E_START_MARITIME_TRADE', careerOption: 'bowl_trade', critical: 'A_NAT_BOWL_COMMON_HOME',
    trap: 'E_NATIVE_BOWL_BEG_MERCY', death: 'D_NAT_BOWL_TERRITORY', deathFlag: 'F_NAT_BOWL_DEATH_TERRITORY', deathAchievement: 'A_NAT_BOWL_KEYS_LESSON' },
  { key: 'BOOK', card: 'CARD_NATIVE_BOOK', chain: 'CHAIN_NAT_SCHOLAR_MINISTER', prefix: 'F_NAT_BOOK_',
    opening: ['E_NAT_BOOK_OPEN_CHILD', 'E_NAT_BOOK_OPEN_YOUTH', 'E_NAT_BOOK_OPEN_ADULT', 'E_NAT_BOOK_OPEN_ELDER'],
    main: ['E_NATIVE_SCALES_CUNNING', 'E_NATIVE_SCALES_SILVER', 'E_NATIVE_BOOK_PETITION', 'E_NAT_BOOK_GOVERNANCE'],
    fast: ['E_NAT_BOOK_FAST_REGISTER', 'E_NAT_BOOK_FAST_WEIGH', 'E_NAT_BOOK_FAST_RELIEF'], breakthrough: 'E_NAT_BOOK_BREAKTHROUGH',
    career: 'E_START_IMPERIAL_EXAM', careerOption: 'book_exam', critical: 'A_NAT_BOOK_LEGACY',
    trap: 'E_NAT_BOOK_ARCHIVE_ROAD', death: 'D_NAT_BOOK_SCROLL_BRIDGE', deathFlag: 'F_NAT_BOOK_DEATH_BRIDGE', deathAchievement: 'A_NAT_BOOK_EXAM_DELAY' },
];
type Build = typeof builds[number];

// Only the offered card, opening age/year, and unrelated event candidates change.
// In particular, no lifespan, attribute, condition, DC, effect or saved state is patched.
function scenario(build: Build, year = 1632, age = 21, extra: string[] = []) {
  const bundle = structuredClone(production);
  bundle.rules.age_bands = [{ id: 'regression_age', min: age, max: age, weight: 1, modifiers: {} }];
  bundle.rules.opening.year_min = year;
  bundle.rules.opening.year_max = year;
  const pool = bundle.pools.find(item => item.id === bundle.rules.opening.pool_id)!;
  // Native relics are no longer production offers; route coverage uses an explicit fixture.
  pool.entries = [{ card_id: build.card, weight: 1 }];
  const keep = new Set([...build.opening, ...build.main, ...build.fast, ...extra]);
  bundle.events = bundle.events.filter(event => event.trigger.kind === 'chain' || keep.has(event.id));
  return bundle;
}
function ok(result: CommandResult): Success {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}
function start(bundle: ContentBundle, build: Build, seed: number) {
  const engine = new GameEngine(bundle, fingerprint);
  const initial = ok(engine.initGame({ seed }));
  expect(initial.pending?.kind === 'card' && initial.pending.cards.includes(build.card)).toBe(true);
  const result = ok(engine.selectCard('select', build.card));
  return { engine, result, logs: [...result.logs], sequence: 0 };
}
interface Run { engine: GameEngine; result: Success; logs: LogEntry[]; sequence: number; finalChoice?: string }
function choose(run: Run, id: string) {
  const pending = run.result.pending;
  if (pending?.kind !== 'option') throw new Error(`Expected choice, got ${pending?.kind}`);
  expect(pending.options.find(option => option.id === id)?.available, `${pending.event_id}/${id}`).toBe(true);
  run.result = ok(run.engine.resolveOption(`option:${run.sequence++}`, pending.event_instance_id, id));
  run.logs.push(...run.result.logs);
}
function advance(run: Run, build: Build, opening = 'invest') {
  const pending = run.result.pending;
  if (pending?.kind === 'option') {
    const preferred = build.opening.includes(pending.event_id) ? opening
      : pending.event_id === build.career ? build.careerOption
      : pending.event_id === build.breakthrough ? 'breakthrough'
      : pending.event_id === build.main[build.main.length - 1] ? run.finalChoice ?? 'publish' : 'qualify';
    const option = pending.options.find(item => item.id === preferred && item.available)
      ?? pending.options.find(item => item.id === 'safe' && item.available)
      ?? pending.options.find(item => item.risk === 'safe' && item.available)
      ?? pending.options.find(item => item.available);
    if (!option) throw new Error(`No available option: ${pending.event_id}`);
    choose(run, option.id);
    return;
  }
  run.result = pending?.kind === 'stage'
    ? ok(run.engine.resolveStage(`stage:${run.sequence++}`, pending.event_instance_id, pending.stage_id))
    : ok(run.engine.nextYear(`year:${run.sequence++}`));
  run.logs.push(...run.result.logs);
}
function until(run: Run, build: Build, stop: (run: Run) => boolean, opening = 'invest') {
  for (let commands = 0; commands < 160; commands++) {
    if (stop(run) || run.result.state.status === 'ENDED') return run;
    advance(run, build, opening);
  }
  throw new Error(`Scenario failed to settle: ${build.key}`);
}
function through(run: Run, build: Build, year: number, opening = 'invest') {
  return until(run, build, current => current.result.state.status === 'READY' && current.result.state.player.calendar_year >= year, opening);
}
function encounters(run: Run, ids: string[]) {
  return run.logs.filter(log => log.type === 'event' && ids.includes(log.source_id));
}
function findRun(bundle: ContentBundle, build: Build, endYear: number, predicate: (run: Run) => boolean, opening = 'invest') {
  for (let seed = 1; seed <= 512; seed++) {
    const run = through(start(bundle, build, seed), build, endYear, opening);
    if (predicate(run)) return { run, seed };
  }
  throw new Error(`No natural seed in 1..512 meets scenario for ${build.key}`);
}

describe('remaining relic builds through the production engine', () => {
  it.each(builds)('$key offers the three opening paths at all eight age boundaries', build => {
    for (const [age, index] of [[3, 0], [10, 0], [11, 1], [20, 1], [21, 2], [45, 2], [46, 3], [65, 3]] as const) {
      for (const option of ['invest', 'support', 'withdraw']) {
        const run = start(scenario(build, 1632, age), build, 1);
        expect(run.result.pending?.kind === 'option' && run.result.pending.event_id).toBe(build.opening[index!]);
        const pending = run.result.pending;
        if (pending?.kind !== 'option') throw new Error('Opening must pause for a choice');
        expect(run.result.state.player.chains.filter(item => item.chain_id === build.chain)).toHaveLength(0);
        choose(run, option);
        expect(run.result.state.player.chains.filter(item => item.chain_id === build.chain)).toHaveLength(option === 'withdraw' ? 0 : 1);
        expect(run.result.state.player.flags.includes(build.prefix + 'ABORT')).toBe(option === 'withdraw');
      }
    }
  });

  it.each(builds)('$key registers once and schedules its complete ordinary chain relative to started_year', build => {
    const bundle = scenario(build);
    const { run } = findRun(bundle, build, 1641, item => encounters(item, build.main).length === build.main.length
      && item.result.state.player.chains.some(chain => chain.chain_id === build.chain && chain.status === 'completed'));
    const instances = run.result.state.player.chains.filter(item => item.chain_id === build.chain);
    expect(instances).toHaveLength(1);
    expect(encounters(run, build.main).map(log => [log.source_id, log.calendar_year - instances[0]!.started_year]))
      .toEqual(build.main.map((id, index) => [id, [1, 3, 6, 8][index]]));
    expect(run.logs.filter(log => log.type === 'chain' && log.data.chain_id === build.chain && log.data.action === 'started')).toHaveLength(1);
    expect(instances[0]!.status).toBe('completed');
  }, 60_000);

  it.each(builds)('$key does not certify a failed final check or offer an unearned breakthrough', build => {
    const bundle = scenario(build, 1632, 21, [build.breakthrough]);
    const finalId = build.main[build.main.length - 1]!;
    const { run } = findRun(bundle, build, 1641, item => item.logs.some(log => log.type === 'dice'
      && log.source_id === finalId && !log.data.success));
    expect(run.result.state.player.chains.find(chain => chain.chain_id === build.chain)!.status).toBe('interrupted');
    expect(run.result.state.player.flags).not.toContain(build.prefix + 'DONE');
    expect(run.result.state.player.flags).not.toContain(build.prefix + 'READY');
    expect(encounters(run, [build.breakthrough])).toEqual([]);
    expect(run.result.state.status).not.toBe('ENDED');
  }, 60_000);

  it.each(builds)('$key only accepts the 1643/1644 historical fast-forward with consent', build => {
    for (const year of [1642, 1643, 1644, 1645]) {
      const late = year === 1643 || year === 1644;
      for (const opening of ['invest', 'support', 'withdraw']) {
        const choice = late && opening !== 'withdraw' ? opening + '_late' : opening;
        const run = through(start(scenario(build, year), build, 1), build, Math.max(year, 1644), choice);
        expect(encounters(run, build.fast).map(log => log.source_id)).toEqual(late && opening !== 'withdraw' ? build.fast : []);
        for (const log of encounters(run, build.fast)) expect(log.calendar_year).toBe(1644);
        expect(run.logs.filter(log => log.type === 'option' && build.fast.includes(log.source_id))).toEqual([]);
        expect(run.result.state.player.chains.filter(item => item.chain_id === build.chain)).toHaveLength(late || opening === 'withdraw' ? 0 : 1);
        expect(run.result.state.player.flags.includes(build.prefix + 'FAST_ACCEPTED')).toBe(late && opening !== 'withdraw');
      }
    }
  });

  it.each(builds)('$key leaves a live safe and exit path at its final ordinary node', build => {
    const bundle = scenario(build);
    for (const option of ['safe', 'exit']) {
      let found = false;
      for (let seed = 1; seed <= 128 && !found; seed++) {
        const run = until(start(bundle, build, seed), build, item => item.result.pending?.kind === 'option' && item.result.pending.event_id === build.main[build.main.length - 1]);
        if (run.result.pending?.kind !== 'option') continue;
        expect(run.result.pending.options.filter(item => item.available).map(item => item.id)).toEqual(expect.arrayContaining(['publish', 'safe', 'exit']));
        choose(run, option);
        expect(run.result.state.status).not.toBe('ENDED');
        expect(run.result.state.player.flags).toContain(build.prefix + (option === 'exit' ? 'ABORT' : 'READY'));
        found = true;
      }
      expect(found, `${build.key}/${option} reachable`).toBe(true);
    }
  }, 60_000);

  it.each(builds)('$key resolves natural D20 failure, success and critical breakthrough outcomes', build => {
    const bundle = scenario(build, 1632, 21, [build.career, build.breakthrough]);
    const observed = new Set<string>();
    for (let seed = 1; seed <= 512 && observed.size < 3; seed++) {
      const run = until(start(bundle, build, seed), build, item => item.logs.some(log => log.type === 'dice' && log.source_id === build.breakthrough)
        || item.result.state.player.calendar_year > 1642);
      const dice = run.logs.find(log => log.type === 'dice' && log.source_id === build.breakthrough);
      if (dice?.type !== 'dice') continue;
      const kind = dice.data.raw === 20 ? 'critical' : dice.data.success ? 'success' : 'failure';
      expect(dice.data.raw).toBeGreaterThanOrEqual(1);
      expect(dice.data.raw).toBeLessThanOrEqual(20);
      if (dice.data.raw < 10) expect(dice.data.success).toBe(false);
      expect(run.result.state.player.flags).toContain(build.prefix + (dice.data.success ? 'BREAK_SUCCESS' : 'BREAK_FAILED'));
      if (kind === 'critical') {
        expect(dice.data.success).toBe(true);
        expect(run.result.state.player.flags).toContain(build.prefix + 'CRITICAL');
        expect(run.result.state.player.achievements).toContain(build.critical);
      }
      if (build.key === 'GLUE') expect(dice.data).toMatchObject({ stage_id: 'glue_craft_test', dc: 11 });
      observed.add(kind);
    }
    expect([...observed].sort()).toEqual(['critical', 'failure', 'success']);
  }, 120_000);

  it.each(builds)('$key checks real breakthrough eligibility and keeps both safe choices actionable', build => {
    const blocked = new Set<string>();
    let enabled = false;
    for (const career of [false, true]) {
      const bundle = scenario(build, 1632, 21, [build.breakthrough, ...(career ? [build.career] : [])]);
      for (let seed = 1; seed <= 128; seed++) {
        const initial: Run = start(bundle, build, seed);
        initial.finalChoice = seed % 3 === 0 ? 'safe' : 'publish';
        const run = until(initial, build, item => item.result.pending?.kind === 'option' && item.result.pending.event_id === build.breakthrough
          || item.result.state.player.calendar_year > 1642, seed % 2 ? 'support' : 'invest');
        const pending = run.result.pending;
        if (pending?.kind !== 'option' || pending.event_id !== build.breakthrough) continue;
        const event = bundle.events.find(item => item.id === build.breakthrough)!;
        if (event.interaction !== 'choice') throw new Error('Breakthrough must be a choice');
        const condition = event.options.find(item => item.id === 'breakthrough')!.condition;
        const context = conditionContext(run.result.state.player, run.result.state.timeline);
        const available = pending.options.find(item => item.id === 'breakthrough')!.available;
        expect(available).toBe(evaluateCondition(condition, context));
        enabled ||= available;
        // Inspect missing leaves against the actual earned player, never an injected context.
        // Nested all/any groups differ between builds (notably LIGHTER).
        const recordMissing = (gate: NonNullable<typeof condition>) => {
          if (evaluateCondition(gate, context)) return;
          expect(available).toBe(false);
          if (gate.op === 'all' || gate.op === 'any') {
            gate.conditions.forEach(recordMissing);
          } else {
            blocked.add(gate.op === 'compare' ? 'attributes' : gate.op === 'is' ? 'career' : 'evidence');
          }
        };
        if (condition) recordMissing(condition);
        expect(pending.options.find(item => item.id === 'safe')?.available).toBe(true);
        expect(pending.options.find(item => item.id === 'withdraw')?.available).toBe(true);
        if (!available) {
          const rejected = run.engine.resolveOption(`locked:${seed}`, pending.event_instance_id, 'breakthrough');
          expect(rejected.ok).toBe(false);
          choose(run, seed % 2 ? 'safe' : 'withdraw');
          expect(run.result.state.player.flags).toContain(build.prefix + (seed % 2 ? 'BREAK_SAFE' : 'BREAK_RETIRED'));
          expect(run.result.state.status).not.toBe('ENDED');
        }
      }
    }
    expect(enabled, 'A genuinely earned route must enable the breakthrough').toBe(true);
    expect(blocked.size, 'At least one naturally unearned prerequisite must lock the choice').toBeGreaterThan(0);
  }, 120_000);

  it.each(builds)('$key awards the death achievement in the fatal command and has a natural rescue', build => {
    const bundle = scenario(build, 1632, 21, [build.trap]);
    // The book needs the ordinary account-keeping node; the other four can withdraw
    // without gaining attributes that would remove their authored trap condition.
    const opening = build.key === 'BOOK' ? 'invest' : 'withdraw';
    const fatal = findRun(bundle, build, 1642, run => run.logs.some(log => log.type === 'death' && log.source_id === build.death), opening);
    expect(fatal.run.result.state.status).toBe('ENDED');
    expect(fatal.run.result.state.player.flags).toContain(build.deathFlag);
    expect(fatal.run.result.state.player.achievements).toContain(build.deathAchievement);
    expect(fatal.run.result.logs.some(log => log.type === 'achievement' && log.data.achievement_id === build.deathAchievement)).toBe(true);
    expect(fatal.run.logs.some(log => log.type === 'dice' && log.source_id === build.trap && !log.data.success)).toBe(true);
    const rescue = findRun(bundle, build, 1642, run => run.logs.some(log => log.type === 'dice' && log.source_id === build.trap && log.data.success)
      && !run.logs.some(log => log.type === 'death' && log.source_id === build.death), opening);
    expect(rescue.run.result.state.player.flags).not.toContain(build.deathFlag);
    // Replay the discovered seed, rather than manufacturing a favourable roll.
    const replay = through(start(bundle, build, fatal.seed), build, 1642, opening);
    expect(replay.logs).toEqual(fatal.run.logs);
    expect(replay.result.state).toEqual(fatal.run.result.state);
  }, 120_000);
});
