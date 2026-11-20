import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { cloneData } from '../src/game/core/engine/cloneData.ts';
import { isInheritanceBonus } from '../src/game/core/engine/Inheritance.ts';
import { GameSession } from '../src/game/application/GameSession.ts';
import { CurrentLifeStore } from '../src/game/application/CurrentLifeStore.ts';
import { executeCommand, validateReplayCommands } from '../src/game/application/ReplayCommands.ts';
import { sha256Json } from '../src/game/core/persistence/JsonDigest.ts';

const production = await loadContent();
const fingerprint = 'inheritance-regression';
const attributes = ['physique', 'intelligence', 'wealth', 'prestige', 'luck'];
const extraCard = { kind: 'extra_card', card_id: openingPool().entries.find(entry => entry.weight > 0).card_id };
const attributeBonus = attribute => ({ kind: 'attribute', attribute });
const bonuses = [undefined, ...attributes.map(attributeBonus), extraCard];
const options = inheritance => inheritance === undefined ? { seed: 1 } : { seed: 1, inheritance };
const newEngine = (content = production) => new GameEngine(content, fingerprint);
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result; };

function begin(inheritance, content = production) {
  const engine = newEngine(content);
  const result = ok(engine.initGame(options(inheritance)));
  assert.equal(result.pending.kind, 'card');
  return { engine, result, save: engine.exportSave() };
}

function memoryPorts() {
  let durable = null;
  return {
    async persist(save) { durable = structuredClone(save); },
    async load() { return structuredClone(durable); },
    hash: sha256Json,
  };
}

function nextEngineCommand(engine, id) {
  const { state, pending } = engine.current();
  if (state.status === 'ENDED') return null;
  if (pending?.kind === 'option') {
    const option = pending.options.find(item => item.available);
    assert.ok(option);
    return engine.resolveOption(id, pending.event_instance_id, option.id);
  }
  if (pending?.kind === 'stage') return engine.resolveStage(id, pending.event_instance_id, pending.stage_id);
  assert.notEqual(pending?.kind, 'card');
  return engine.nextYear(id);
}

function nextSessionAction(session) {
  const { state, pending } = session.current();
  if (state.status === 'ENDED') return null;
  if (pending?.kind === 'option') {
    const option = pending.options.find(item => item.available);
    assert.ok(option);
    return { type: 'choose', optionId: option.id };
  }
  if (pending?.kind === 'stage') return { type: 'stage' };
  assert.notEqual(pending?.kind, 'card');
  return { type: 'next' };
}

function openingPool(content = production) {
  return content.pools.find(pool => pool.id === content.rules.opening.pool_id);
}

test('each attribute inheritance adds only its clamped point without changing the random stream', () => {
  const baseline = begin();
  assert.equal(baseline.result.pending.cards.length, 3);
  assert.equal(baseline.save.payload.run.inheritance, null);
  assert.equal(baseline.save.save_version, 5);

  for (const attribute of attributes) {
    const inheritance = attributeBonus(attribute);
    const actual = begin(inheritance);
    const expectedPlayer = cloneData(baseline.save.payload.player);
    expectedPlayer.attributes[attribute] = Math.min(production.rules.attributes.max, expectedPlayer.attributes[attribute] + 1);
    assert.deepEqual(actual.save.payload.player, expectedPlayer, attribute);
    const expectedRun = cloneData(baseline.save.payload.run);
    expectedRun.inheritance = cloneData(inheritance);
    assert.deepEqual(actual.save.payload.run, expectedRun, attribute);
    assert.deepEqual(actual.result.pending.cards, baseline.result.pending.cards, attribute);
  }
});

test('inherited card occupies one of at most three unique positive-weight candidates', () => {
  const extra = begin(extraCard);
  const offers = extra.result.pending.cards;
  assert.equal(offers.length, 3);
  assert.equal(offers[0], extraCard.card_id);
  assert.equal(new Set(offers).size, offers.length);
  const eligible = new Set(openingPool().entries.filter(entry => entry.weight > 0).map(entry => entry.card_id));
  assert.ok(offers.every(id => eligible.has(id)));
  for (const card_id of eligible) for (const seed of [0, 1, 42]) {
    const opening = ok(newEngine().initGame({ seed, inheritance: { kind: 'extra_card', card_id } }));
    assert.equal(opening.pending.cards.length, Math.min(3, eligible.size));
    assert.equal(new Set(opening.pending.cards).size, opening.pending.cards.length);
    assert.equal(opening.pending.cards.filter(id => id === card_id).length, 1);
  }

  for (const cardId of offers) {
    const { engine } = begin(extraCard);
    const selected = ok(engine.selectCard('select', cardId));
    assert.deepEqual(selected.state.player.cards, [cardId]);
    assert.deepEqual(engine.exportSave().payload.player.cards, [cardId]);
    assert.deepEqual(engine.exportSave().payload.run.card_offers, []);
  }
});

test('inheritance respects the attribute cap and the actual positive-weight pool size', () => {
  const capped = structuredClone(production);
  capped.rules.attributes.base = capped.rules.attributes.max;
  for (const source of [...capped.rules.age_bands, ...capped.castes, ...capped.regions, ...capped.era.backgrounds]) source.modifiers = {};
  const baseline = begin(undefined, capped);
  assert.ok(attributes.every(attribute => baseline.save.payload.player.attributes[attribute] === capped.rules.attributes.max));
  for (const attribute of attributes) {
    const boosted = begin(attributeBonus(attribute), capped);
    assert.deepEqual(boosted.save.payload.player.attributes, baseline.save.payload.player.attributes, attribute);
  }

  const small = structuredClone(production);
  for (const [index, entry] of openingPool(small).entries.entries()) if (index >= 2) entry.weight = 0;
  const ordinarySmall = begin(undefined, small);
  const extraSmall = begin(extraCard, small);
  assert.equal(extraSmall.result.pending.cards.length, 2);
  assert.deepEqual(new Set(extraSmall.result.pending.cards), new Set(ordinarySmall.result.pending.cards));
  assert.equal(extraSmall.result.pending.cards[0], extraCard.card_id);
  assert.equal(new Set(extraSmall.result.pending.cards).size, 2);
  const restored = newEngine(small);
  restored.restoreSave(extraSmall.save);
  assert.deepEqual(restored.exportSave(), extraSmall.save);
  for (const entry of openingPool(small).entries) entry.weight = 0;
  assert.throws(() => newEngine(small).initGame(options(extraCard)), { code: 'INVALID_INHERITANCE' });
});

test('inheritance input has an exact shape and is copied into both run and replay', async () => {
  const valid = [extraCard, ...attributes.map(attributeBonus)];
  const invalid = [null, undefined, [], {}, 'extra_card', 0, { kind: 'unknown' }, { kind: 'extra_card' },
    { kind: 'extra_card', card_id: '' }, { kind: 'extra_card', card_id: 7 },
    { kind: 'extra_card', attribute: 'luck' }, { kind: 'extra_card', card_id: extraCard.card_id, extra: true },
    { kind: 'attribute' }, { kind: 'attribute', attribute: 'health' },
    { kind: 'attribute', attribute: null }, { kind: 'attribute', attribute: 'luck', extra: true },
    Object.defineProperty({ ...extraCard }, 'extra', { value: true }),
    { ...extraCard, [Symbol('extra')]: true }, Object.defineProperty({}, 'kind', { value: 'extra_card' })];
  for (const value of valid) assert.equal(isInheritanceBonus(value), true);
  for (const value of invalid) {
    assert.equal(isInheritanceBonus(value), false);
    assert.throws(() => newEngine().initGame({ seed: 1, inheritance: value }), { code: 'INVALID_INHERITANCE' });
  }
  assert.throws(() => newEngine().initGame(options({ kind: 'extra_card', card_id: 'CARD_NOT_IN_OPENING_POOL' })), { code: 'INVALID_INHERITANCE' });
  const inheritedInvalid = Object.assign(Object.create({ inheritance: null }), { seed: 1 });
  assert.throws(() => newEngine().initGame(inheritedInvalid), { code: 'INVALID_INHERITANCE' });

  const bonus = attributeBonus('physique');
  const engine = newEngine();
  ok(engine.initGame(options(bonus)));
  bonus.attribute = 'wealth';
  assert.deepEqual(engine.exportSave().payload.run.inheritance, cloneData(attributeBonus('physique')));

  const sessionBonus = attributeBonus('intelligence');
  const session = new GameSession(newEngine(), memoryPorts());
  ok(await session.initialize(1, sessionBonus));
  sessionBonus.attribute = 'luck';
  const save = session.exportSave();
  assert.deepEqual(save.engine.payload.run.inheritance, cloneData(attributeBonus('intelligence')));
  assert.deepEqual(save.replay_commands[0].args, { seed: 1, inheritance: attributeBonus('intelligence') });
});

test('replay validation accepts exactly the seed-only or valid inheritance initialization forms', () => {
  const command = args => [{ api: 'initGame', commandId: 'init', args, expected_result_hash: '0'.repeat(64) }];
  for (const inheritance of bonuses) validateReplayCommands(command(options(inheritance)), 'life');
  for (const args of [
    { seed: 1, inheritance: null }, { seed: 1, inheritance: undefined }, { seed: 1, inheritance: [] },
    { seed: 1, inheritance: { kind: 'attribute', attribute: 'unknown' } },
    { seed: 1, inheritance: { kind: 'extra_card', extra: true } },
    { seed: 1, extra: true }, Object.defineProperty({ seed: 1 }, 'extra', { value: true }),
    { seed: 1, [Symbol('extra')]: true }, { seed: 1.5 }, { seed: -1 }, { seed: 0x1_0000_0000 },
  ]) assert.throws(() => validateReplayCommands(command(args), 'life'), { code: 'REPLAY_INVALID' });
  const bonus = attributeBonus('luck');
  const replayed = newEngine();
  const result = ok(executeCommand(replayed, { api: 'initGame', commandId: 'init', args: options(bonus) }));
  assert.deepEqual(replayed.exportSave().payload.run.inheritance, cloneData(bonus));
  assert.equal(result.state.player.attributes.luck, begin(bonus).result.state.player.attributes.luck);
});

test('engine saves restore all inheritance modes and produce identical subsequent command results', () => {
  for (const inheritance of bonuses) {
    const { engine, result } = begin(inheritance);
    const restored = newEngine();
    restored.restoreSave(engine.exportSave());
    assert.deepEqual(restored.exportSave(), engine.exportSave());
    const card = result.pending.cards.at(-1);
    assert.deepEqual(ok(restored.selectCard('select', card)), ok(engine.selectCard('select', card)));
    assert.deepEqual(restored.exportSave(), engine.exportSave());
    const next = nextEngineCommand(engine, 'after-select');
    const replayNext = nextEngineCommand(restored, 'after-select');
    assert.deepEqual(replayNext, next);
    if (next) ok(next);
    assert.deepEqual(restored.exportSave(), engine.exportSave());
    const postSelect = newEngine();
    postSelect.restoreSave(engine.exportSave());
    assert.deepEqual(postSelect.exportSave(), engine.exportSave());
    assert.deepEqual(nextEngineCommand(postSelect, 'after-restore'), nextEngineCommand(engine, 'after-restore'));
    assert.deepEqual(postSelect.exportSave(), engine.exportSave());
  }
});

test('session replay preserves reward and command hashes before and after card selection', async () => {
  for (const inheritance of bonuses) {
    const session = new GameSession(newEngine(), memoryPorts());
    const result = ok(await session.initialize(1, inheritance));
    const save = session.exportSave();
    assert.deepEqual(save.replay_commands[0].args, options(inheritance));
    const restored = new GameSession(newEngine(), memoryPorts());
    restored.restoreSave(save);
    assert.deepEqual(restored.exportSave(), save);
    const action = { type: 'selectCard', cardId: result.pending.cards.at(-1) };
    assert.deepEqual(ok(await restored.command(action)), ok(await session.command(action)));
    assert.deepEqual(restored.exportSave(), session.exportSave());
    const postSelect = new GameSession(newEngine(), memoryPorts());
    postSelect.restoreSave(session.exportSave());
    assert.deepEqual(postSelect.exportSave(), session.exportSave());
    const next = nextSessionAction(session);
    assert.deepEqual(nextSessionAction(postSelect), next);
    if (next) assert.deepEqual(ok(await postSelect.command(next)), ok(await session.command(next)));
    assert.deepEqual(postSelect.exportSave(), session.exportSave());
  }
});

test('the inherited slot can be replaced, remains replayable and selects only one card', async () => {
  const session = new GameSession(newEngine(), memoryPorts());
  const result = ok(await session.initialize(1, extraCard));
  const replacement = openingPool().entries.find(entry => entry.weight > 0 && !result.pending.cards.includes(entry.card_id)).card_id;
  const before = session.exportSave().engine.payload.run.prng;
  ok(await session.command({ type: 'replaceCardOffer', previousCardId: extraCard.card_id, cardId: replacement }));
  const exchanged = session.exportSave();
  assert.equal(exchanged.engine.payload.run.card_offers.length, 3);
  assert.ok(exchanged.engine.payload.run.card_offers.includes(replacement));
  assert.deepEqual(exchanged.engine.payload.run.prng, before);
  const restored = new GameSession(newEngine(), memoryPorts());
  restored.restoreSave(exchanged);
  assert.deepEqual(restored.exportSave(), exchanged);
  const action = { type: 'selectCard', cardId: replacement };
  assert.deepEqual(ok(await restored.command(action)), ok(await session.command(action)));
  assert.deepEqual(restored.exportSave().engine.payload.player.cards, [replacement]);
  assert.deepEqual(restored.exportSave(), session.exportSave());
});

test('changed inheritance, candidate lists and replay initialization cannot be restored', async () => {
  const attributed = begin(attributeBonus('luck')).save;
  const changedAttribute = structuredClone(attributed);
  changedAttribute.payload.run.inheritance = attributeBonus('intelligence');
  assert.throws(() => newEngine().restoreSave(changedAttribute), { code: 'SAVE_INVALID' });
  const malformedAttribute = structuredClone(attributed);
  malformedAttribute.payload.run.inheritance = { kind: 'attribute', attribute: 'luck', extra: true };
  assert.throws(() => newEngine().restoreSave(malformedAttribute), { code: 'SAVE_INVALID' });
  const missingAttribute = structuredClone(attributed);
  delete missingAttribute.payload.run.inheritance;
  assert.throws(() => newEngine().restoreSave(missingAttribute), { code: 'SAVE_INVALID' });
  const hiddenRewardField = structuredClone(attributed);
  Object.defineProperty(hiddenRewardField.payload.run.inheritance, 'extra', { value: true });
  assert.throws(() => newEngine().restoreSave(hiddenRewardField), { code: 'SAVE_INVALID' });
  const hiddenRunField = structuredClone(attributed);
  Object.defineProperty(hiddenRunField.payload.run, 'extra', { value: true });
  assert.throws(() => newEngine().restoreSave(hiddenRunField), { code: 'SAVE_INVALID' });

  const extra = begin(extraCard).save;
  const noReward = structuredClone(extra);
  noReward.payload.run.inheritance = null;
  assert.throws(() => newEngine().restoreSave(noReward), { code: 'SAVE_INVALID' });
  const changedOffer = structuredClone(extra);
  changedOffer.payload.run.card_offers[2] = openingPool().entries.find(entry => entry.weight > 0 && !extra.payload.run.card_offers.includes(entry.card_id)).card_id;
  assert.throws(() => newEngine().restoreSave(changedOffer), { code: 'SAVE_INVALID' });
  const duplicateOffer = structuredClone(extra);
  duplicateOffer.payload.run.card_offers[2] = duplicateOffer.payload.run.card_offers[0];
  assert.throws(() => newEngine().restoreSave(duplicateOffer), { code: 'SAVE_INVALID' });
  const fourthOffer = structuredClone(extra);
  fourthOffer.payload.run.card_offers.push(openingPool().entries.find(entry => entry.weight > 0 && !extra.payload.run.card_offers.includes(entry.card_id)).card_id);
  assert.throws(() => newEngine().restoreSave(fourthOffer), { code: 'SAVE_INVALID' });

  const session = new GameSession(newEngine(), memoryPorts());
  ok(await session.initialize(1, extraCard));
  const original = session.exportSave();
  for (const replacement of [undefined, attributeBonus('luck'), null, { kind: 'extra_card', extra: true }]) {
    const tampered = structuredClone(original);
    if (replacement === undefined) delete tampered.replay_commands[0].args.inheritance;
    else tampered.replay_commands[0].args.inheritance = replacement;
    assert.throws(() => new GameSession(newEngine(), memoryPorts()).restoreSave(tampered), { code: 'SAVE_INVALID' });
  }
  const badHash = structuredClone(original);
  badHash.replay_commands[0].expected_result_hash = '0'.repeat(64);
  assert.throws(() => new GameSession(newEngine(), memoryPorts()).restoreSave(badHash), { code: 'SAVE_INVALID' });
});

test('v4 life saves are rejected without changing their input or overwriting stored current lives', async () => {
  const session = new GameSession(newEngine(), memoryPorts());
  ok(await session.initialize(1));
  const legacy = session.exportSave();
  legacy.engine.save_version = 4;
  legacy.engine.rules_implementation_version = 1;
  delete legacy.engine.payload.run.inheritance;
  const original = structuredClone(legacy);
  assert.throws(() => newEngine().restoreSave(legacy.engine), { code: 'SAVE_VERSION_MISMATCH' });
  assert.deepEqual(structuredClone(legacy), original);
  assert.throws(() => new GameSession(newEngine(), memoryPorts()).restoreSave(legacy), { code: 'SAVE_VERSION_MISMATCH' });
  assert.deepEqual(structuredClone(legacy), original);

  const items = new Map();
  const storage = {
    getItem(key) { return items.has(key) ? items.get(key) : null; },
    setItem(key, value) { items.set(key, value); },
  };
  const writer = new CurrentLifeStore(storage);
  assert.equal(writer.read(() => {}).status, 'empty');
  writer.write(legacy, 'legacy-life');
  const before = new Map(items);
  const reader = new CurrentLifeStore(storage);
  assert.equal(reader.read(save => new GameSession(newEngine(), memoryPorts()).restoreSave(save)).status, 'incompatible');
  assert.throws(() => reader.write(session.exportSave(), 'new-life'), { code: 'SAVE_FAILED' });
  assert.deepEqual(items, before);
});

test('older inheritance rule saves remain explicitly incompatible and are not overwritten', async () => {
  const session = new GameSession(newEngine(), memoryPorts());
  ok(await session.initialize(1, extraCard));
  const legacy = session.exportSave();
  legacy.engine.rules_implementation_version = 2;
  legacy.engine.payload.run.inheritance = { kind: 'extra_card' };
  legacy.replay_commands[0].args.inheritance = { kind: 'extra_card' };
  legacy.engine.payload.run.card_offers.push(openingPool().entries.find(entry => entry.weight > 0 && !legacy.engine.payload.run.card_offers.includes(entry.card_id)).card_id);
  const items = new Map();
  const storage = {
    getItem(key) { return items.get(key) ?? null; },
    setItem(key, value) { items.set(key, value); },
  };
  const writer = new CurrentLifeStore(storage);
  assert.equal(writer.read(() => {}).status, 'empty');
  writer.write(legacy, 'legacy-inheritance');
  const before = new Map(items);
  const reader = new CurrentLifeStore(storage);
  assert.equal(reader.read(save => new GameSession(newEngine(), memoryPorts()).restoreSave(save)).status, 'incompatible');
  assert.throws(() => reader.write(session.exportSave(), 'new-life'), { code: 'SAVE_FAILED' });
  assert.deepEqual(items, before);
});
