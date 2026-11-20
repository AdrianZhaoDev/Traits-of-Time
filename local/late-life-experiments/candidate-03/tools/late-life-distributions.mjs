import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const counts = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { n: sorted.length, min: sorted[0] ?? null, p10: rank(.1), p50: rank(.5), p90: rank(.9), max: sorted.at(-1) ?? null };
};
export function analyzeDistributions(lives) {
  const stateGroup = states => ({
    n: states.length,
    attributes: Object.fromEntries(['physique', 'wealth', 'prestige', 'intelligence', 'luck'].map(key => [key, distribution(states.map(state => state.attributes[key]))])),
    identities: counts(states.map(state => state.identity_id)),
    ages: distribution(states.map(state => state.age)),
    completed_chains: counts(states.flatMap(state => state.chains.filter(chain => chain.status === 'completed').map(chain => chain.chain_id))),
    interrupted_chains: counts(states.flatMap(state => state.chains.filter(chain => chain.status === 'interrupted').map(chain => chain.chain_id))),
    flags: counts(states.flatMap(state => state.flags)),
  });
  return Object.fromEntries(['all', 'normal', 'cautious', 'risky', 'career'].map(strategy => {
    const group = lives.filter(life => strategy === 'all' || life.strategy === strategy);
    return [strategy, {
      opening: stateGroup(group.map(life => life.evidence.initial_state)),
      year_10: stateGroup(group.flatMap(life => life.evidence.year_10_state ? [life.evidence.year_10_state] : [])),
      legacy_gaps_over_six: group.filter(life => life.late_longest_no_progress_years > 6).map(life => ({
        seed: life.seed, strategy: life.strategy, card: life.card, start_age: life.start_age,
        gap: life.late_longest_no_progress_years,
        choice_diagnostics: {
          no_eligible_choice_years: life.late_choice_candidates.eligible_years === 0,
          category_budget_exhausted: life.category_budget_exhausted_at_year_10,
          reasons: life.late_choice_candidates.reasons,
        },
        // These are choice diagnostics, not a causal explanation of missing material progress.
        progress_cause: 'requires_event_and_state_review',
      })),
    }];
  }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node tools/late-life-distributions.mjs INPUT.jsonl OUTPUT.json');
  const lives = [];
  for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const life = JSON.parse(line);
    life.evidence.commands = [];
    life.evidence.year_states = [];
    lives.push(life);
  }
  writeFileSync(output, `${JSON.stringify(analyzeDistributions(lives), null, 2)}\n`, { flag: 'wx' });
}
