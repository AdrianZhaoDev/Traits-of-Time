import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { ContentLoadError } from '../../assets/scripts/application/ContentPackage.js';
import { canonicalJson, sha256 } from '../../tools/lib/canonical.js';
import { validateContent } from '../../assets/scripts/core/content/ContentValidator.js';
import { createContentRegistry } from '../../assets/scripts/core/content/ContentRegistry.js';
import type { ContentBundle, Condition } from '../../assets/scripts/core/types/content.generated.js';
import { createContentFixture, loadTemplate } from '../helpers/content.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

async function fixture(mutate?: (bundle: ContentBundle) => void) {
  const result = await createContentFixture(mutate);
  cleanups.push(result.cleanup);
  return result;
}

async function expectIssue(directory: string, code: string, file: string, path: string) {
  let caught: unknown;
  try { await loadContent(directory); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ContentLoadError);
  expect((caught as ContentLoadError).issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code, file, path, message: expect.any(String) }),
  ]));
}

function choice(bundle: ContentBundle) {
  const event = bundle.events.find((item) => item.id === 'E_OPEN_SAFE');
  if (!event || event.interaction !== 'choice') throw new Error('Expected template opening choice');
  return event;
}

function pool(bundle: ContentBundle) {
  const result = bundle.pools.find((item) => item.id === 'POOL_PITY');
  if (!result) throw new Error('Expected template pity pool');
  return result;
}

const noEffects = () => ({ text: '明确无变化', effects: [], next_stage_id: null });

describe('trusted complete content packages', () => {
  it('loads the complete local template with a stable content fingerprint', async () => {
    const { directory, bundle } = await fixture();
    const loaded = await loadContent(directory);
    expect(loaded.bundle).toEqual(bundle);
    expect(loaded.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(validateContent(loaded.bundle)).toEqual({ ok: true, issues: [] });
    expect(Object.isFrozen(loaded.bundle)).toBe(true);
    expect(Object.isFrozen(loaded.bundle.events[0])).toBe(true);
    expect(() => loaded.bundle.cards.push(bundle.cards[0]!)).toThrow();
  });

  it('builds read-only ID maps without prototype-key collisions', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.cards.push({ ...bundle.cards[0]!, id: '__proto__' });
    });
    const { bundle } = await loadContent(directory);
    const registry = createContentRegistry(bundle);
    expect(registry.cards.get('__proto__')?.id).toBe('__proto__');
    expect(registry.events.get('E_WORK')?.id).toBe('E_WORK');
    expect(registry.cards.size).toBe(bundle.cards.length);
    expect([...registry.cards.keys()]).toEqual(bundle.cards.map((card) => card.id));
    expect([...registry.cards.values()]).toEqual(bundle.cards);
    expect([...registry.cards.entries()]).toEqual(bundle.cards.map((card) => [card.id, card]));
    expect([...registry.cards]).toEqual([...registry.cards.entries()]);
    const visited: string[] = [];
    registry.cards.forEach((card, id, map) => {
      visited.push(id);
      expect(map.has(card.id)).toBe(true);
    });
    expect(visited).toEqual(bundle.cards.map((card) => card.id));
    expect('set' in registry.cards).toBe(false);
  });

  it('ignores JSON whitespace and key order but fingerprints narrative, values, and array order', async () => {
    const { directory } = await fixture();
    const initial = await loadContent(directory);
    const path = join(directory, 'cards.json');
    const cards = JSON.parse(await readFile(path, 'utf8')) as ContentBundle['cards'];
    await writeFile(path, JSON.stringify(cards.map(({ id, name, ...rest }) => ({ ...rest, name, id })), null, 4));
    expect((await loadContent(directory)).fingerprint).toBe(initial.fingerprint);
    cards[0]!.description += '新叙事';
    await writeFile(path, JSON.stringify(cards));
    const narrative = await loadContent(directory);
    expect(narrative.fingerprint).not.toBe(initial.fingerprint);
    cards.reverse();
    await writeFile(path, JSON.stringify(cards));
    expect((await loadContent(directory)).fingerprint).not.toBe(narrative.fingerprint);
  });

  it('returns missing-file and JSON parsing issues at their actual file', async () => {
    const { directory } = await fixture();
    await rm(join(directory, 'cards.json'));
    await expectIssue(directory, 'CONTENT_READ_FAILED', 'cards.json', '');
    await writeFile(join(directory, 'cards.json'), '[not json');
    await expectIssue(directory, 'JSON_PARSE', 'cards.json', '');
  });

  it('checks the manifest structure before trusting its files map', async () => {
    const { directory, bundle } = await fixture();
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...bundle.manifest, files: {} }));
    await expectIssue(directory, 'SCHEMA_INVALID', 'manifest.json', '/files/rules');
  });

  it.each(['../outside.json', '/tmp/outside.json', 'https://example.com/cards.json', 'C:\\outside.json', 'sub/../cards.json'])('rejects escaping manifest paths: %s', async (file) => {
    const { directory, bundle } = await fixture();
    bundle.manifest.files.cards = file;
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(bundle.manifest));
    await expectIssue(directory, 'CONTENT_PATH_INVALID', 'manifest.json', '/files/cards');
  });

  it('rejects symlink escapes without reading outside package data', async () => {
    const inside = await fixture();
    const outside = await fixture();
    await rm(join(inside.directory, 'cards.json'));
    await symlink(join(outside.directory, 'cards.json'), join(inside.directory, 'cards.json'));
    await expectIssue(inside.directory, 'CONTENT_PATH_INVALID', 'manifest.json', '/files/cards');
  });

  it('uses the trusted schema even if an external package supplies a permissive schema', async () => {
    const { directory } = await fixture();
    await writeFile(join(directory, 'content.schema.json'), JSON.stringify({ type: 'object' }));
    const cards = JSON.parse(await readFile(join(directory, 'cards.json'), 'utf8')) as Array<Record<string, unknown>>;
    cards[0]!.script = 'execute anything';
    await writeFile(join(directory, 'cards.json'), JSON.stringify(cards));
    await expectIssue(directory, 'SCHEMA_INVALID', 'cards.json', '/0/script');
  });

  it('maps validation issues to custom nested manifest filenames', async () => {
    const { directory, bundle } = await fixture();
    await mkdir(join(directory, 'nested'));
    bundle.manifest.files.cards = 'nested/deck.json';
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(bundle.manifest));
    await writeFile(join(directory, 'nested/deck.json'), JSON.stringify([{ name: 'missing id' }]));
    await expectIssue(directory, 'SCHEMA_INVALID', 'nested/deck.json', '/0/id');
  });
});

describe('structural validation', () => {
  it.each([null, undefined, [], {}, 42, 'not a bundle'])('safely rejects unknown input %j', (value) => {
    expect(validateContent(value)).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA_INVALID' })]) });
  });

  it('rejects malformed nested unknown values without throwing', async () => {
    const bundle = await loadTemplate();
    const malformed = { ...bundle, events: [{ id: 'broken', trigger: null }] };
    expect(() => validateContent(malformed)).not.toThrow();
    expect(validateContent(malformed).ok).toBe(false);
  });

  it('rejects cyclic object graphs and throwing accessors safely', async () => {
    const cyclic = await loadTemplate();
    const loop: Record<string, unknown> = { op: 'not' };
    loop.condition = loop;
    (choice(cyclic) as unknown as Record<string, unknown>).condition = loop;
    expect(() => validateContent(cyclic)).not.toThrow();
    expect(validateContent(cyclic).ok).toBe(false);
    const accessor = { get manifest() { throw new Error('hostile accessor'); } };
    expect(() => validateContent(accessor)).not.toThrow();
    expect(validateContent(accessor).ok).toBe(false);
  });

  it('rejects unknown fields, missing IDs, and empty choice options', async () => {
    const { directory, bundle } = await fixture();
    const events = structuredClone(bundle.events) as unknown as Array<Record<string, unknown>>;
    const index = events.findIndex((event) => event.id === 'E_OPEN_SAFE');
    events[index]!.options = [];
    await writeFile(join(directory, 'events.json'), JSON.stringify(events));
    await expectIssue(directory, 'SCHEMA_INVALID', 'events.json', `/${index}/options`);
    const cards = structuredClone(bundle.cards) as unknown as Array<Record<string, unknown>>;
    delete cards[0]!.id;
    await writeFile(join(directory, 'cards.json'), JSON.stringify(cards));
    await expectIssue(directory, 'SCHEMA_INVALID', 'cards.json', '/0/id');
  });

  it('rejects foreign schema references as unknown content fields', async () => {
    const { directory, bundle } = await fixture();
    await writeFile(join(directory, 'rules.json'), JSON.stringify({ ...bundle.rules, $ref: 'https://example.com/schema' }));
    await expectIssue(directory, 'SCHEMA_INVALID', 'rules.json', '/$ref');
  });

  it('rejects negative weights, out-of-range probabilities and unsafe integer counts', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.pools[0]!.entries[0]!.weight = -1;
      choice(bundle).trigger = { kind: 'opening', weight: 1, trigger_probability: 1.1 };
      bundle.rules.events.per_year = Number.MAX_SAFE_INTEGER + 1;
    });
    await expectIssue(directory, 'SCHEMA_INVALID', 'pools.json', '/0/entries/0/weight');
    await expectIssue(directory, 'SCHEMA_INVALID', 'rules.json', '/events/per_year');
  });

  it('rejects non-finite values from the direct core validation API', async () => {
    const bundle = await loadTemplate();
    bundle.rules.attributes.base = Infinity;
    expect(validateContent(bundle)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEMA_INVALID', file: 'rules.json', path: '/attributes/base' }),
    ]) });
  });
});

describe('direct unknown-input schema contract', () => {
  const mutations: Array<[string, (bundle: ContentBundle) => void, string, string]> = [
    ['required field', (bundle) => { delete (bundle.cards[0] as Partial<ContentBundle['cards'][number]>).id; }, 'cards.json', '/0/id'],
    ['unknown escaped field', (bundle) => { Object.assign(bundle.rules, { 'foreign/~field': true }); }, 'rules.json', '/foreign~1~0field'],
    ['empty string', (bundle) => { bundle.cards[0]!.id = ''; }, 'cards.json', '/0/id'],
    ['enum', (bundle) => { Object.assign(choice(bundle).options[0]!, { risk: 'impossible' }); }, 'events.json', '/0/options/0/risk'],
    ['constant', (bundle) => { Object.assign(bundle.manifest, { schema_version: 1 }); }, 'manifest.json', '/schema_version'],
    ['number minimum', (bundle) => { bundle.pools[0]!.entries[0]!.weight = -1; }, 'pools.json', '/0/entries/0/weight'],
    ['integer maximum', (bundle) => { bundle.rules.events.per_year = Number.MAX_SAFE_INTEGER + 1; }, 'rules.json', '/events/per_year'],
    ['integer type', (bundle) => { bundle.rules.events.per_year = 0.5; }, 'rules.json', '/events/per_year'],
    ['boolean type', (bundle) => { Object.assign(bundle.pools[0]!, { replacement: 'yes' }); }, 'pools.json', '/0/replacement'],
    ['array type', (bundle) => { Object.assign(bundle, { cards: {} }); }, 'cards.json', ''],
    ['minimum items', (bundle) => { bundle.rules.age_bands = []; }, 'rules.json', '/age_bands'],
    ['unique items', (bundle) => { bundle.cards[0]!.tags = ['same', 'same']; }, 'cards.json', '/0/tags/1'],
    ['nullable union', (bundle) => { Object.assign(pool(bundle), { hard_pity: 7 }); }, 'pools.json', '/1/hard_pity'],
    ['nonempty condition', (bundle) => { choice(bundle).condition = { op: 'all', conditions: [] }; }, 'events.json', '/0/condition/conditions'],
    ['exclusive event shape', (bundle) => { Object.assign(choice(bundle), { outcome: noEffects() }); }, 'events.json', '/0/outcome'],
    ['annual restricted effects', (bundle) => { Object.assign(bundle.era.injuries[0]!, { annual_effects: [{ type: 'flag_add', id: 'f' }] }); }, 'era.json', '/injuries/0/annual_effects/0/type'],
  ];
  it.each(mutations)('rejects %s with a file-local pointer', async (_label, mutate, file, path) => {
    const bundle = await loadTemplate();
    mutate(bundle);
    expect(validateContent(bundle)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEMA_INVALID', file, path }),
    ]) });
  });

  it('rejects non-JSON primitives, sparse arrays, custom prototypes and symbols', async () => {
    const values: unknown[] = [NaN, () => 1, 1n, new Date(), { [Symbol('x')]: 1 }];
    const sparse = await loadTemplate();
    sparse.cards = new Array(1);
    values.push(sparse);
    for (const value of values) expect(validateContent(value).ok).toBe(false);
  });
});

describe('semantic references and effect consistency', () => {
  it('finds duplicate IDs independently in entity and local collections', async () => {
    const { directory, bundle } = await fixture((value) => {
      value.cards.push({ ...value.cards[0]! });
      choice(value).options.push({ ...choice(value).options[0]! });
    });
    await expectIssue(directory, 'DUPLICATE_ID', 'cards.json', `/${bundle.cards.length - 1}/id`);
    const index = bundle.events.findIndex((event) => event.id === 'E_OPEN_SAFE');
    await expectIssue(directory, 'DUPLICATE_ID', 'events.json', `/${index}/options/2/id`);
  });

  it('checks pool card references and hard-pity targets', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.pools[0]!.entries[0]!.card_id = 'missing';
      pool(bundle).hard_pity = { after: 3, target_card_ids: ['not-in-pool'] };
    });
    await expectIssue(directory, 'MISSING_REFERENCE', 'pools.json', '/0/entries/0/card_id');
    await expectIssue(directory, 'MISSING_REFERENCE', 'pools.json', '/1/hard_pity/target_card_ids/0');
  });

  it('checks effect IDs and nested condition IDs', async () => {
    const { directory, bundle } = await fixture((value) => {
      choice(value).options[0]!.outcome.effects = [{ type: 'chain_start', id: 'missing' }];
      choice(value).condition = { op: 'not', condition: { op: 'has', collection: 'injuries', id: 'missing' } };
    });
    const index = bundle.events.findIndex((event) => event.id === 'E_OPEN_SAFE');
    await expectIssue(directory, 'MISSING_REFERENCE', 'events.json', `/${index}/options/0/outcome/effects/0/id`);
    await expectIssue(directory, 'MISSING_REFERENCE', 'events.json', `/${index}/condition/condition/id`);
  });

  it('rejects depth-nine conditions and unsupported background dependencies', async () => {
    const { directory, bundle } = await fixture((value) => {
      let condition: Condition = { op: 'compare', field: 'age', comparator: 'gte', value: 1 };
      for (let index = 0; index < 8; index++) condition = { op: 'not', condition };
      choice(value).condition = condition;
      value.era.backgrounds[0]!.condition = { op: 'has', collection: 'cards', id: 'CARD_RARE' };
    });
    const index = bundle.events.findIndex((event) => event.id === 'E_OPEN_SAFE');
    await expectIssue(directory, 'INVALID_COMBINATION', 'events.json', `/${index}/condition${'/condition'.repeat(8)}`);
    await expectIssue(directory, 'INVALID_COMBINATION', 'era.json', '/backgrounds/0/condition');
  });

  it('reports annual-effect references at the actual array location', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.era.injuries[0]!.annual_effects = [{ type: 'death', id: 'missing' }];
    });
    await expectIssue(directory, 'MISSING_REFERENCE', 'era.json', '/injuries/0/annual_effects/0/id');
  });

  it('rejects contradictory flag and location updates', async () => {
    const { directory, bundle } = await fixture((value) => {
      choice(value).options[0]!.outcome.effects = [
        { type: 'flag_add', id: 'f' }, { type: 'flag_remove', id: 'f' },
        { type: 'region_set', id: value.regions[0]!.id }, { type: 'region_set', id: value.regions[1]!.id },
      ];
    });
    const index = bundle.events.findIndex((event) => event.id === 'E_OPEN_SAFE');
    await expectIssue(directory, 'INVALID_COMBINATION', 'events.json', `/${index}/options/0/outcome/effects/1`);
    await expectIssue(directory, 'INVALID_COMBINATION', 'events.json', `/${index}/options/0/outcome/effects/3`);
  });

  it('rejects death with rewards, continued stages, or following effects', async () => {
    const { directory, bundle } = await fixture((value) => {
      choice(value).options[0]!.outcome = {
        text: '矛盾结果', next_stage_id: 'S1', effects: [
          { type: 'death', id: 'D_OPENING' }, { type: 'attribute_add', attribute: 'wealth', amount: 1 },
        ],
      };
    });
    const index = bundle.events.findIndex((event) => event.id === 'E_OPEN_SAFE');
    await expectIssue(directory, 'INVALID_COMBINATION', 'events.json', `/${index}/options/0/outcome`);
  });

  it('forbids completion deaths or new-chain recursion and requires chain-event nodes', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.chains[0]!.nodes[0]!.event_id = 'E_WORK';
      bundle.chains[0]!.completion.effects = [
        { type: 'chain_start', id: 'CH_WORKSHOP' }, { type: 'death', id: 'D_CRISIS' },
      ];
    });
    await expectIssue(directory, 'INVALID_COMBINATION', 'chains.json', '/0/nodes/0/event_id');
    await expectIssue(directory, 'INVALID_COMBINATION', 'chains.json', '/0/completion/effects/0');
    await expectIssue(directory, 'INVALID_COMBINATION', 'chains.json', '/0/completion/effects/1');
  });
});

describe('stage graphs and chronological constraints', () => {
  it('rejects dangling, unreachable and cyclic stages', async () => {
    const { directory, bundle } = await fixture((value) => {
      const event = choice(value);
      event.options[0]!.outcome.next_stage_id = 'S1';
      event.options[1]!.outcome.next_stage_id = 'missing';
      event.stages = [
        { id: 'S1', text: '循环', check: { attribute: 'intelligence', dc: 12, modifier: 0 }, success: { ...noEffects(), next_stage_id: 'S1' }, failure: noEffects() },
        { id: 'S2', text: '不可达', check: { attribute: 'physique', dc: 12, modifier: 0 }, success: noEffects(), failure: noEffects() },
      ];
    });
    const index = bundle.events.findIndex((event) => event.id === 'E_OPEN_SAFE');
    await expectIssue(directory, 'MISSING_REFERENCE', 'events.json', `/${index}/options/1/outcome/next_stage_id`);
    await expectIssue(directory, 'INVALID_GRAPH', 'events.json', `/${index}/stages/0`);
    await expectIssue(directory, 'INVALID_GRAPH', 'events.json', `/${index}/stages/1`);
  });

  it('accepts a terminating reachable diamond stage graph', async () => {
    const { directory } = await fixture((bundle) => {
      const event = choice(bundle);
      event.options[0]!.outcome.next_stage_id = 'S1';
      event.stages = [
        { id: 'S1', text: '一步', check: { attribute: 'intelligence', dc: 12, modifier: 0 }, success: { ...noEffects(), next_stage_id: 'S2' }, failure: { ...noEffects(), next_stage_id: 'S2' } },
        { id: 'S2', text: '二步', check: { attribute: 'physique', dc: 12, modifier: 0 }, success: noEffects(), failure: noEffects() },
      ];
    });
    await expect(loadContent(directory)).resolves.toHaveProperty('fingerprint');
  });

  it('rejects history outside its window and non-increasing chain years', async () => {
    const { directory, bundle } = await fixture((value) => {
      const history = value.events.find((event) => event.trigger.kind === 'historical')!;
      if (history.trigger.kind === 'historical') history.trigger.year = value.era.start_year - 1;
      value.chains[0]!.nodes[1]!.after_years = value.chains[0]!.nodes[0]!.after_years;
    });
    const index = bundle.events.findIndex((event) => event.trigger.kind === 'historical');
    await expectIssue(directory, 'INVALID_COMBINATION', 'events.json', `/${index}/trigger/year`);
    await expectIssue(directory, 'INVALID_COMBINATION', 'chains.json', '/0/nodes/1/after_years');
  });
});

describe('viable starting and sampling distributions', () => {
  it('rejects zero pools, zero pity targets, and no-replacement pity', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.pools[0]!.entries.forEach((entry) => { entry.weight = 0; });
      const pity = pool(bundle);
      pity.entries.find((entry) => entry.card_id === 'CARD_EPIC')!.weight = 0;
      pity.replacement = false;
    });
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'pools.json', '/0/entries');
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'pools.json', '/1/hard_pity/target_card_ids');
    await expectIssue(directory, 'INVALID_COMBINATION', 'pools.json', '/1/hard_pity');
  });

  it('rejects overlapping age bands, absent starting backgrounds, and impossible lifespan', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.rules.age_bands[1]!.min = bundle.rules.age_bands[0]!.max;
      bundle.era.backgrounds = [];
      bundle.rules.lifespan = { min: 1, max: 2, min_remaining_years: 3 };
    });
    await expectIssue(directory, 'INVALID_COMBINATION', 'rules.json', '/age_bands/1');
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'era.json', '/backgrounds');
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'rules.json', '/lifespan');
  });

  it('finds isolated invalid ages rather than only checking band endpoints', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.era.backgrounds.forEach((background) => {
        background.condition = { op: 'all', conditions: [
          ...(background.condition ? [background.condition] : []),
          { op: 'compare', field: 'age', comparator: 'ne', value: 7 },
        ] };
      });
    });
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'era.json', '/backgrounds');
  });

  it('rejects overflowing total pool weights', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.pools[0]!.entries[0]!.weight = Number.MAX_VALUE;
      bundle.pools[0]!.entries[1]!.weight = Number.MAX_VALUE;
    });
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'pools.json', '/0/entries');
  });

  it('rejects missing opening pools and inverted opening years', async () => {
    const missing = await fixture((bundle) => { bundle.rules.opening.pool_id = 'NO_POOL'; });
    await expectIssue(missing.directory, 'MISSING_REFERENCE', 'rules.json', '/opening/pool_id');
    const inverted = await fixture((bundle) => {
      bundle.rules.opening.year_min = 1641;
      bundle.rules.opening.year_max = 1640;
    });
    await expectIssue(inverted.directory, 'INVALID_COMBINATION', 'rules.json', '/opening');
  });

  it.each(['before', 'after'] as const)('rejects opening years %s the historical era', async (side) => {
    const { directory } = await fixture((bundle) => {
      const year = side === 'before' ? bundle.era.start_year - 1 : bundle.era.historical_end_year + 1;
      bundle.rules.opening.year_min = year;
      bundle.rules.opening.year_max = year;
    });
    await expectIssue(directory, 'INVALID_COMBINATION', 'rules.json', '/opening');
  });

  it.each([-0.01, 1.01])('rejects automatic ratio outside [0, 1]: %s', async (ratio) => {
    const { directory } = await fixture((bundle) => { bundle.rules.events.automatic_ratio = ratio; });
    await expectIssue(directory, 'SCHEMA_INVALID', 'rules.json', '/events/automatic_ratio');
  });

  it('rejects invalid rule bounds and inverted historical windows', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.rules.attributes = { min: 3, max: 3, base: 8 };
      bundle.rules.check = { modifier_min: 2, modifier_max: -2 };
      bundle.rules.luck = { factor_min: 2, factor_max: 1 };
      bundle.rules.opening.year_min = 1642;
      bundle.rules.opening.year_max = 1640;
      bundle.era.historical_end_year = bundle.era.start_year - 1;
    });
    await expectIssue(directory, 'INVALID_COMBINATION', 'rules.json', '/attributes');
    await expectIssue(directory, 'INVALID_COMBINATION', 'rules.json', '/check');
    await expectIssue(directory, 'INVALID_COMBINATION', 'rules.json', '/luck');
    await expectIssue(directory, 'INVALID_COMBINATION', 'rules.json', '/opening');
    await expectIssue(directory, 'INVALID_COMBINATION', 'era.json', '/historical_end_year');
  });

  it('rejects age, biography, and rare-event effective weight overflow', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.rules.age_bands.forEach((band) => { band.weight = Number.MAX_VALUE; });
      bundle.era.backgrounds.forEach((background) => { background.weight = Number.MAX_VALUE; });
      const event = bundle.events.find((item) => item.trigger.kind === 'random')!;
      if (event.trigger.kind === 'random') {
        event.trigger.rare = true;
        event.trigger.weight = Number.MAX_VALUE;
      }
    });
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'rules.json', '/age_bands');
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'events.json', '');
  });

  it('proves all ages in large legal bands without enumerating billions of years', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.rules.age_bands = [{ id: 'wide', min: 0, max: 2 ** 32 - 1, weight: 1, modifiers: {} }];
      bundle.rules.lifespan = { min: 2 ** 32, max: 2 ** 32, min_remaining_years: 1 };
      bundle.era.backgrounds.forEach((background) => { delete background.condition; });
    });
    await expect(loadContent(directory)).resolves.toHaveProperty('fingerprint');
  });

  it('rejects unsafe remaining-years arithmetic and overflowing calendar years', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.rules.age_bands = [{ id: 'old', min: Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, weight: 1, modifiers: {} }];
      bundle.rules.lifespan = { min: Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, min_remaining_years: 1 };
    });
    await expectIssue(directory, 'INVALID_DISTRIBUTION', 'rules.json', '/lifespan');
    const calendar = await fixture((bundle) => {
      bundle.era.start_year = Number.MAX_SAFE_INTEGER;
      bundle.era.historical_end_year = Number.MAX_SAFE_INTEGER;
      bundle.rules.opening.year_min = Number.MAX_SAFE_INTEGER;
      bundle.rules.opening.year_max = Number.MAX_SAFE_INTEGER;
      bundle.events = bundle.events.filter((event) => event.trigger.kind !== 'historical');
    });
    await expectIssue(calendar.directory, 'INVALID_COMBINATION', 'rules.json', '/opening/year_max');
  });

  it('rejects non-finite modifier sums before simulation can produce invalid attributes', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.regions.forEach((region) => { region.modifiers.wealth = Number.MAX_VALUE; });
      bundle.castes.forEach((caste) => { caste.modifiers.wealth = Number.MAX_VALUE; });
    });
    await expectIssue(directory, 'INVALID_COMBINATION', 'rules.json', '/attributes');
  });

  it('accepts zero annual events with a valid opening card pool', async () => {
    const { directory } = await fixture((bundle) => {
      bundle.rules.events = { per_year: 0, automatic_ratio: 0.6 };
    });
    await expect(loadContent(directory)).resolves.toHaveProperty('fingerprint');
  });
});

describe('canonical JSON', () => {
  it('sorts keys recursively, preserves arrays and encodes Unicode', () => {
    expect(canonicalJson({ z: [2, 1], a: { 中: '文字', a: -0 } })).toBe('{"a":{"a":0,"中":"文字"},"z":[2,1]}');
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }));
    expect(sha256([1, 2])).not.toBe(sha256([2, 1]));
  });

  it('rejects values outside the JSON domain instead of silently changing them', () => {
    for (const value of [undefined, NaN, Infinity, 1n, { a: undefined }, () => 1]) {
      expect(() => canonicalJson(value)).toThrow();
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow();
  });
});
