import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ReadableStream } from 'node:stream/web';
import { join } from 'node:path';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { ContentLoadError } from '../../assets/scripts/application/ContentPackage.js';
import { assertDestinationOutsideContent } from '../../tools/lib/cli.js';
import { createContentFixture } from '../helpers/content.js';

const base = 'https://content.example/packs/test/';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(cleanups.splice(0).map(fn => fn())); });

async function remote() {
  const fixture = await createContentFixture();
  cleanups.push(fixture.cleanup);
  const documents = new Map<string, string>();
  for (const file of ['manifest.json', ...Object.values(fixture.bundle.manifest.files)]) {
    documents.set(new URL(file, base).href, await readFile(join(fixture.directory, file), 'utf8'));
  }
  const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const text = documents.get(String(input));
    return new Response(text ?? 'missing', { status: text === undefined ? 404 : 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { ...fixture, documents, fetcher };
}

async function issue(code: string, file: string, path = '') {
  await expect(loadContent(base)).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code, file, path })]) });
}

describe('complete HTTPS content packages', () => {
  it('loads all manifest JSON categories with identical local fingerprint and deep freezing', async () => {
    const fixture = await remote();
    const local = await loadContent(fixture.directory);
    const loaded = await loadContent(base.slice(0, -1));
    expect(loaded).toEqual(local);
    expect(Object.isFrozen(loaded.bundle.events[0])).toBe(true);
    expect(fixture.fetcher.mock.calls.map(([url]) => String(url))).toEqual([...fixture.documents.keys()]);
    for (const [, init] of fixture.fetcher.mock.calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('supports nested package-relative JSON paths', async () => {
    const fixture = await remote();
    fixture.bundle.manifest.files.cards = 'nested/cards.json';
    fixture.documents.set(`${base}manifest.json`, JSON.stringify(fixture.bundle.manifest));
    fixture.documents.set(`${base}nested/cards.json`, JSON.stringify(fixture.bundle.cards));
    expect((await loadContent(base)).bundle.cards).toEqual(fixture.bundle.cards);
  });

  it.each(['../cards.json', 'sub/../cards.json', '/cards.json', '//evil.example/cards.json', 'https://evil.example/cards.json', 'http://evil.example/cards.json', 'C:\\cards.json', 'sub\\cards.json', '%2e%2e/cards.json', '%252e%252e/cards.json', 'sub%2fcards.json', 'cards.json?x=1', 'cards.json#x', './cards.json', 'sub//cards.json', ' cards.json', 'cards.json\n'])('rejects unsafe manifest path before requesting it: %s', async file => {
    const fixture = await remote();
    fixture.bundle.manifest.files.cards = file;
    fixture.documents.set(`${base}manifest.json`, JSON.stringify(fixture.bundle.manifest));
    await issue('CONTENT_PATH_INVALID', 'manifest.json', '/files/cards');
    expect(fixture.fetcher.mock.calls.every(([url]) => String(url).startsWith(base))).toBe(true);
    expect(fixture.fetcher.mock.calls.some(([url]) => String(url) === `${base}${file}`)).toBe(false);
  });

  it.each(['http://content.example/pack/', 'https://user:secret@content.example/pack/', 'https://content.example/pack/?token=x', 'https://content.example/pack/#fragment'])('rejects insecure or ambiguous source: %s', async source => {
    const fixture = await remote();
    await expect(loadContent(source)).rejects.toBeInstanceOf(ContentLoadError);
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });

  it('reports HTTP failures and malformed JSON without returning a partial bundle', async () => {
    const fixture = await remote();
    fixture.documents.delete(`${base}events.json`);
    fixture.documents.set(`${base}cards.json`, '{broken');
    await issue('CONTENT_READ_FAILED', 'events.json');
    await issue('JSON_PARSE', 'cards.json');
  });

  it('rejects invalid manifest before any category requests', async () => {
    const fixture = await remote();
    fixture.documents.set(`${base}manifest.json`, '{"files":{}}');
    await issue('SCHEMA_INVALID', 'manifest.json', '/content_id');
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses trusted schema and cross-file validation, never remote schema', async () => {
    const fixture = await remote();
    fixture.documents.set(`${base}content.schema.json`, '{}');
    fixture.documents.set(`${base}cards.json`, JSON.stringify([{ ...fixture.bundle.cards[0], script: 'untrusted' }]));
    await issue('SCHEMA_INVALID', 'cards.json', '/0/script');
    fixture.documents.set(`${base}cards.json`, '[]');
    await expect(loadContent(base)).rejects.toBeInstanceOf(ContentLoadError);
    expect(fixture.fetcher.mock.calls.some(([url]) => String(url).includes('schema'))).toBe(false);
  });

  it('reports network failures through content errors', async () => {
    const fixture = await remote();
    fixture.fetcher.mockRejectedValue(new TypeError('fetch failed: redirect or aborted request'));
    await issue('CONTENT_READ_FAILED', 'manifest.json');
  });

  it('rejects an interrupted response body rather than publishing a snapshot', async () => {
    const fixture = await remote();
    fixture.fetcher.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('connection closed while reading JSON')); },
    })));
    await issue('CONTENT_READ_FAILED', 'manifest.json');
  });

  it('allows local CLI state and replay destinations for HTTPS content', async () => {
    await expect(assertDestinationOutsideContent(base, '.local-state/remote-life')).resolves.toBeUndefined();
  });
});
