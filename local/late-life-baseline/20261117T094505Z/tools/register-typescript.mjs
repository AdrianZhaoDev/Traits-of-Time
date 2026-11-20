import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL);
      if (!existsSync(url) && existsSync(new URL(`${url.href}.ts`))) {
        return nextResolve(`${url.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), {
        loader: 'ts', format: 'esm', target: 'node22', sourcefile: fileURLToPath(url), sourcemap: 'inline',
      }).code };
    }
    if (url.startsWith('file:') && url.endsWith('.json')) {
      return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(new URL(url), 'utf8')};` };
    }
    return nextLoad(url, context);
  },
});
