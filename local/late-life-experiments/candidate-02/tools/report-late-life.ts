import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { causalProgress, type CausalMapping } from './late-life-causality';
import { lateLifeTelemetry } from './late-life-evidence';
import { percentile, type LifeReport } from './simulate';

const [input, mappingFile, output] = process.argv.slice(2);
if (!input || !mappingFile || !output) throw Error('Usage: node --import ./tools/register-typescript.mjs tools/report-late-life.ts INPUT.jsonl MAPPING.json OUTPUT.json');
const mappings = JSON.parse(readFileSync(mappingFile, 'utf8')) as CausalMapping[];
const rows = [];
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const life = JSON.parse(line) as LifeReport;
  const causal = causalProgress(life, mappings);
  const telemetry = lateLifeTelemetry(life);
  rows.push({ seed: life.seed, strategy: life.strategy, card: life.card, start_age: life.start_age,
    reached_year_10: life.reached_year_10, end_age: life.end_age, choices: life.choices.length,
    old_gap: life.late_longest_no_progress_years, causal_gap: causal.longest_gap,
    active_causal_gap: causal.active_development_longest_gap, settlement_start_year: causal.settlement_start_year,
    meanings: causal.meanings, arrangements: causal.arrangements, transitions: telemetry.transitions,
    overdue_windows: telemetry.overdue_windows, repeated_events: telemetry.repeated_events });
}
const summaries = Object.fromEntries(['all', 'normal', 'cautious', 'risky', 'career'].map(strategy => {
  const group = rows.filter(row => row.reached_year_10 && (strategy === 'all' || row.strategy === strategy));
  const all = rows.filter(row => strategy === 'all' || row.strategy === strategy);
  return [strategy, { n: group.length, old_gap_p90: percentile(group.map(row => row.old_gap), .9), causal_gap_p90: percentile(group.map(row => row.causal_gap), .9),
    active_causal_gap_p90: percentile(group.map(row => row.active_causal_gap), .9),
    total_lives: all.length, early_deaths: all.filter(row => !row.reached_year_10).length,
    end_age_p50: percentile(all.map(row => row.end_age), .5),
    choices_min: all.length ? Math.min(...all.map(row => row.choices)) : null,
    choices_max: all.length ? Math.max(...all.map(row => row.choices)) : null,
    over_six: group.filter(row => row.causal_gap > 6).map(row => ({ seed: row.seed, strategy: row.strategy, gap: row.causal_gap })),
    overdue_windows: group.reduce((sum, row) => sum + row.overdue_windows.length, 0) }];
}));
writeFileSync(output, `${JSON.stringify({ mappings, summaries, rows }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(summaries, null, 2));
