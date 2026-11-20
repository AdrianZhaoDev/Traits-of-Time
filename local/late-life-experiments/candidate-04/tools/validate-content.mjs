import { loadContent } from './content-io.mjs';
import { validateContent } from '../src/game/core/content/ContentValidator.ts';
import { sha256Json } from '../src/game/core/persistence/JsonDigest.ts';
import { getNativeMingEndContent } from '../src/game/application/StaticContentLoader.ts';
import { resolve } from 'node:path';

try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--content')) {
    throw new Error('Usage: npm run validate:content -- --content <directory>');
  }
  const content = await loadContent(args[1]);
  const result = validateContent(content);
  for (const issue of result.issues) console.error(JSON.stringify(issue));
  const fingerprint = sha256Json(content);
  console.log(`sha256Json=${fingerprint}`);
  if (result.ok && resolve(args[1] ?? 'assets/resources/data/ming_end') === resolve('assets/resources/data/ming_end')) {
    const native = getNativeMingEndContent();
    if (native.fingerprint !== fingerprint) throw new Error(`StaticContentLoader fingerprint mismatch: ${native.fingerprint} != ${fingerprint}`);
    console.log('StaticContentLoader fingerprint matches');
  }
  console.log(JSON.stringify({ ok: result.ok, issues: result.issues.length,
    counts: Object.fromEntries(['events', 'chains', 'achievements', 'deaths'].map(key => [key, content[key].length])) }));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(error.stack ?? error);
  process.exitCode = 1;
}
