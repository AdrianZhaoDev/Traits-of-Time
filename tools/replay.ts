import { loadContent } from './lib/ContentLoader.js';
import { readReplay, replay } from './lib/Replay.js';
import { DEFAULT_CONTENT, parseCli, requiredString, runCli } from './lib/cli.js';

await runCli(async () => {
  const args = parseCli({ content: { type: 'string', default: DEFAULT_CONTENT }, file: { type: 'string' }, json: { type: 'boolean' } });
  const file = requiredString(args, 'file');
  const loaded = await loadContent(requiredString(args, 'content'));
  const result = replay(loaded.bundle, loaded.fingerprint, await readReplay(file));
  console.log(args.json ? JSON.stringify(result) : `回放匹配：${result.kind === 'life' ? '人生' : '抽卡'}\n终态哈希：${result.final_hash}`);
});
