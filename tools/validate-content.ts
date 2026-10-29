import { loadContent } from './lib/ContentLoader.js';
import { DEFAULT_CONTENT, parseCli, requiredString, runCli } from './lib/cli.js';

await runCli(async () => {
  const args = parseCli({ content: { type: 'string', default: DEFAULT_CONTENT }, json: { type: 'boolean' } });
  const loaded = await loadContent(requiredString(args, 'content'));
  const result = { ok: true, content_id: loaded.bundle.manifest.content_id, content_version: loaded.bundle.manifest.content_version, fingerprint: loaded.fingerprint };
  console.log(args.json ? JSON.stringify(result) : `内容校验通过：${result.content_id} / ${result.content_version}\n内容指纹：${result.fingerprint}`);
});
