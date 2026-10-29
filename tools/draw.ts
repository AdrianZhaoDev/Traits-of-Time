import { resolve } from 'node:path';
import { GachaEngine, type GachaSave } from '../assets/scripts/core/engine/GachaEngine.js';
import { loadContent } from './lib/ContentLoader.js';
import { load, save } from './lib/FileStateStore.js';
import { canonicalJson } from './lib/canonical.js';
import { DEFAULT_CONTENT, DEFAULT_SEED, parseCli, requiredString, integerArg, assertDestinationOutsideContent, checkSeed, withStateLock, runCli } from './lib/cli.js';

await runCli(async () => {
  const args = parseCli({ content: { type: 'string', default: DEFAULT_CONTENT }, pool: { type: 'string' }, count: { type: 'string' }, seed: { type: 'string' }, 'command-id': { type: 'string' }, state: { type: 'string', default: '.local-state/gacha' }, json: { type: 'boolean' } });
  const directory = requiredString(args, 'state');
  const contentDirectory = requiredString(args, 'content');
  const poolId = requiredString(args, 'pool');
  const count = integerArg(args.count, 'count', 1);
  const commandId = requiredString(args, 'command-id');
  const requestedSeed = args.seed === undefined ? DEFAULT_SEED : integerArg(args.seed, 'seed', 0, 0xffffffff);
  const { bundle, fingerprint } = await loadContent(contentDirectory);
  await assertDestinationOutsideContent(contentDirectory, directory);
  await withStateLock(directory, async () => {
    const stored = await load<GachaSave>(directory);
    const engine = new GachaEngine(bundle, fingerprint, requestedSeed);
    if (stored) {
      engine.restoreSave(stored);
      checkSeed(args.seed !== undefined, requestedSeed, stored.payload.seed);
    }
    const before = engine.exportSave();
    let result = engine.draw(commandId, poolId, count);
    try { await save(directory, engine.exportSave()); }
    catch (error) {
      // A rename may have committed despite a failed response. Never draw again.
      const committed = await load<GachaSave>(directory);
      if (committed) {
        engine.restoreSave(committed);
        const receipt = Object.hasOwn(committed.payload.processed_commands, commandId) ? committed.payload.processed_commands[commandId] : undefined;
        if (receipt && receipt.parameters.poolId === poolId && receipt.parameters.count === count) result = receipt.result;
        else { engine.restoreSave(before); throw error; }
      } else { engine.restoreSave(before); throw error; }
    }
    if (args.json) console.log(canonicalJson(result));
    else {
      console.log(`抽卡完成；种子：${result.seed}\n内容指纹：${result.content_fingerprint}\n存档：${resolve(directory)}`);
      const names = new Map(bundle.cards.map(card => [card.id, card.name]));
      const pool = bundle.pools.find(entry => entry.id === poolId)!;
      for (const item of result.items) console.log(`#${item.draw_index} ${names.get(item.card_id)} (${item.card_id}) [${item.rarity}] 条件概率 ${(item.conditional_probability * 100).toFixed(4)}%；${item.forced_pity ? '触发保底' : '非强制保底'}；${pool.hard_pity ? `距下次保底 ${pool.hard_pity.after - item.pity_after} 抽` : '无保底'}`);
    }
  });
});
