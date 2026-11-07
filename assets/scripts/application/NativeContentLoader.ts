import manifestJson from '../../resources/data/ming_end/manifest.json';
import rulesJson from '../../resources/data/ming_end/rules.json';
import eraJson from '../../resources/data/ming_end/era.json';
import regionsJson from '../../resources/data/ming_end/regions.json';
import castesJson from '../../resources/data/ming_end/castes.json';
import cardsJson from '../../resources/data/ming_end/cards.json';
import poolsJson from '../../resources/data/ming_end/pools.json';
import eventsJson from '../../resources/data/ming_end/events.json';
import chainsJson from '../../resources/data/ming_end/chains.json';
import achievementsJson from '../../resources/data/ming_end/achievements.json';
import deathsJson from '../../resources/data/ming_end/deaths.json';

import type { ContentBundle } from '../core/types/content.generated';
import { freezeContent } from '../core/content/ContentRegistry';
import { validateContent } from '../core/content/ContentValidator';

export interface StaticContentPackage {
  bundle: ContentBundle;
  fingerprint: string;
}

/**
 * Loads the built-in native Ming-End content package directly via imports
 * Zero Node.js / file-system dependency; 100% web & mini-game compatible.
 */
export function getNativeMingEndContent(): StaticContentPackage {
  const rawBundle = {
    manifest: manifestJson,
    rules: rulesJson,
    era: eraJson,
    regions: regionsJson,
    castes: castesJson,
    cards: cardsJson,
    pools: poolsJson,
    events: eventsJson,
    chains: chainsJson,
    achievements: achievementsJson,
    deaths: deathsJson,
  } as unknown as ContentBundle;

  const validation = validateContent(rawBundle);
  if (!validation.ok) {
    const msgs = validation.issues.map((i) => `[${i.code}] ${i.file}:${i.path} ${i.message}`).join('\n');
    throw new Error(`Native ming_end package validation failed:\n${msgs}`);
  }

  // Canonical SHA-256 of the bundled ming_end content.
  const fingerprint = '8d6d5e18de0c3d665ac3fca1a17dfe4ef578ee396d2c890942b0d1a35789a46d';

  return {
    bundle: freezeContent(rawBundle),
    fingerprint,
  };
}
