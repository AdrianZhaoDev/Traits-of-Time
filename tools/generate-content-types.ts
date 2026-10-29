import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

const source = new URL('../assets/resources/data/content.schema.json', import.meta.url);
const destination = new URL('../assets/scripts/core/types/content.generated.ts', import.meta.url);
const schema = JSON.parse(await readFile(source, 'utf8')) as JSONSchema;
const generated = await compile(schema, 'ContentBundle', {
  bannerComment: '/* Generated from assets/resources/data/content.schema.json. Do not edit by hand. */',
  additionalProperties: false,
  unreachableDefinitions: true,
  strictIndexSignatures: true,
  maxItems: -1,
  ignoreMinAndMaxItems: true,
  style: { singleQuote: true, semi: true, tabWidth: 2 },
});
await mkdir(new URL('.', destination), { recursive: true });
await writeFile(destination, generated);
console.log(`Generated ${fileURLToPath(destination)}`);
