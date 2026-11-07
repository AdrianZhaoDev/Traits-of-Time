import { Node, UITransform } from 'cc';
import { createArt } from './ArtAssets';

type EventArtCategory = 'farming' | 'health' | 'workshop' | 'night' | 'market' | 'war' | 'generic';
interface EventArtSpec {
  category: EventArtCategory;
  person?: 'farmer' | 'artisan' | 'merchant';
}

// Exact canonical IDs only. Evidence is each named events.json entry's text, not a
// title/keyword guess, a card in the inventory, or a predicted outcome.
const EVENT_ART: Record<string, EventArtSpec> = {
  // These introductions explicitly show trial fields; only the two naming 老农 use a farmer.
  E_MOD_CORN_OPEN_YOUTH: { category: 'farming', person: 'farmer' },
  E_MOD_CORN_OPEN_ADULT: { category: 'farming' },
  E_MOD_CORN_TRIAL: { category: 'farming', person: 'farmer' },
  E_MOD_CORN_STORE: { category: 'farming' },
  E_MOD_CORN_BREAKTHROUGH: { category: 'farming' },
  // Care/clean-water queues and the two actual plague introductions; no invented healer portrait.
  // The village doctor is explicit in both epidemic-healing career introductions.
  E_CHAIN_EPIDEMIC_HEALING_1: { category: 'health' },
  E_CHAIN_EPIDEMIC_HEALING_2: { category: 'health' },
  E_MOD_HEALER_NODE_1: { category: 'health' },
  E_MOD_HEALER_NODE_2: { category: 'health' },
  E_MOD_HEALER_NODE_3: { category: 'health' },
  E_MOD_HEALER_FAST_1: { category: 'health' },
  E_MOD_HEALER_FAST_2: { category: 'health' },
  E_MOD_HEALER_FAST_3: { category: 'health' },
  E_MOD_HEALER_BREAKTHROUGH: { category: 'health' },
  E_gm_history_plague: { category: 'health' },
  E_HIST_1643_PLAGUE_NORTH: { category: 'health' },
  // Patrol/evidence/evacuation at night. The temple introduction explicitly names a 商队.
  E_MOD_FLASHLIGHT_OPEN_ADULT: { category: 'night' },
  E_MOD_FLASHLIGHT_EVIDENCE: { category: 'night' },
  E_MOD_FLASHLIGHT_PATROL: { category: 'night' },
  E_MOD_FLASHLIGHT_ESCORT: { category: 'night' },
  E_MOD_FLASHLIGHT_FAST_FRAUD: { category: 'night' },
  E_MOD_FLASHLIGHT_FAST_ROTA: { category: 'night' },
  E_MOD_FLASHLIGHT_FAST_EXIT: { category: 'night' },
  E_MOD_FLASHLIGHT_BREAKTHROUGH: { category: 'night' },
  E_MOD_LIGHTER_TEMPLE_FIRE: { category: 'night', person: 'merchant' },
  // Repair scenes; only entries that explicitly name 匠人/船匠/军匠/师傅 get an artisan.
  E_MOD_GLUE_PORCELAIN_MASTER: { category: 'workshop' },
  E_MOD_GLUE_SIEGE_DEFENSE: { category: 'workshop', person: 'artisan' },
  E_MOD_GLUE_SHIP_LEAK: { category: 'workshop', person: 'artisan' },
  E_MOD_GLUE_CRAFT_CHALLENGE: { category: 'workshop' },
  E_MOD_SWISS_PINCH: { category: 'workshop', person: 'artisan' },
  E_MOD_SWISS_MUSKET: { category: 'workshop', person: 'artisan' },
  E_MOD_SWISS_CHIEF: { category: 'workshop', person: 'artisan' },
  E_MOD_SWISS_GUNSMITH: { category: 'workshop' },
  // Grain-store accounting is a market context, not proof of a merchant character.
  E_MOD_CALCULATOR_OPEN_YOUTH: { category: 'market' },
  E_MOD_CALCULATOR_OPEN_ADULT: { category: 'market' },
  E_MOD_CALCULATOR_CORRUPT: { category: 'market' },
  E_MOD_CALCULATOR_TAX: { category: 'market' },
  E_MOD_CALCULATOR_MINISTRY: { category: 'market' },
  E_MOD_CALCULATOR_SSR_TREASURY: { category: 'market' },
  E_MOD_CALCULATOR_BREAKTHROUGH: { category: 'market' },
  E_MOD_GLUE_AMBER_PILL: { category: 'market', person: 'merchant' },
  // These sources explicitly describe wartime troops, supply routes or a besieged city.
  E_HISTORY_1644: { category: 'war' },
  E_gm_history_rebels: { category: 'war' },
  E_gm_history_pass: { category: 'war' },
  E_HIST_1644_JASHEN_FALL: { category: 'war' },
  E_HIST_1644_SHANHAI_PASS: { category: 'war' },
  E_HIST_BEIPING_1644: { category: 'war' },
  E_HIST_1645_YANGZHOU_FATE: { category: 'war' },
  E_MOD_LIGHTER_BEACON_MISSION: { category: 'war' },
  E_MOD_LIGHTER_CANNON_DEFENSE: { category: 'war' },
  E_MOD_LIGHTER_NIGHT_RAID: { category: 'war' },
  E_MOD_LIGHTER_ARMY_REFORM: { category: 'war' },
  E_MOD_LIGHTER_DYNASTY_MIRACLE: { category: 'war' },
  E_MOD_LIGHTER_BREAKTHROUGH: { category: 'war' },
};
// Large illustrations are reserved for a few representative, explicitly sourced
// events. Routine events keep a compact category rail so prose stays prominent.
const FEATURED_EVENTS: Record<string, true> = {
  E_MOD_CORN_TRIAL: true, E_CHAIN_EPIDEMIC_HEALING_1: true, E_MOD_FLASHLIGHT_PATROL: true,
  E_MOD_GLUE_SIEGE_DEFENSE: true, E_MOD_GLUE_SHIP_LEAK: true, E_MOD_CALCULATOR_CORRUPT: true,
  E_MOD_GLUE_AMBER_PILL: true, E_HIST_1644_JASHEN_FALL: true, E_HIST_1645_YANGZHOU_FATE: true,
};
const GENERIC_ART: EventArtSpec = { category: 'generic' };

/** Separate art-only row: original text widths and font sizes are never traded for imagery. */
export function createNarrativeArtSection(parent: Node, eventId: string | undefined, width: number): Node {
  const spec = eventId && Object.prototype.hasOwnProperty.call(EVENT_ART, eventId)
    ? EVENT_ART[eventId] ?? GENERIC_ART : GENERIC_ART;
  const section = new Node(`EventArt_${eventId ?? 'unknown'}`);
  section.layer = parent.layer;
  const transform = section.addComponent(UITransform);
  transform.setAnchorPoint(0.5, 1);
  const featured = eventId !== undefined && FEATURED_EVENTS[eventId] === true;
  const sceneWidth = featured ? Math.min(420, width - 154) : 96;
  const height = sceneWidth * 3 / 5;
  transform.setContentSize(width, height);
  parent.addChild(section);
  // Source assets: events 960×576 (5:3), people 480×600 (4:5). No stretching/cropped text.
  createArt(section, `Illustration_${spec.category}`, `events/${spec.category}`,
    sceneWidth, height, -width / 2 + sceneWidth / 2, -height / 2);
  const railX = featured ? sceneWidth / 2 : -width / 2 + sceneWidth + 28;
  const iconSize = featured && spec.person ? 40 : featured ? 64 : 36;
  createArt(section, `Category_${spec.category}`, `icons/event-${spec.category}`,
    iconSize, iconSize, railX, featured && spec.person ? -28 : -height / 2);
  if (featured && spec.person) {
    createArt(section, `Person_${spec.person}`, `people/${spec.person}`,
      112, 140, railX, -height + 70);
  }
  return section;
}

/** Native hosts can set a component override; Web also honors the system preference. */
export function prefersReducedNarrativeMotion(override: boolean): boolean {
  if (override) return true;
  const host = globalThis as typeof globalThis & { matchMedia?: (query: string) => { matches: boolean } };
  return host.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
