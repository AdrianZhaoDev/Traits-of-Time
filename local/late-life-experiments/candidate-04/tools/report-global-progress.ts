import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { globalProgress, familyMilestones } from './late-life-global-progress';
import { percentile, type LifeReport } from './simulate';
import type { CausalMapping } from './late-life-causality';
const [input, mappingFile, output] = process.argv.slice(2);
if (!input || !mappingFile || !output) throw Error('Usage: report-global-progress.ts INPUT.jsonl MAPPING.json OUTPUT.json');
const mappings = JSON.parse(readFileSync(mappingFile, 'utf8')) as CausalMapping[];
const rows = [];
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const life = JSON.parse(line) as LifeReport;
  // Old enriched baseline predates the explicit denominator: recover it from event/draw logs
  // and all nonterminal year snapshots (same exposure definition as original simulator).
  if (!life.evidence.exposed_years) life.evidence.exposed_years = [...new Set([
    ...life.evidence.year_states.filter(row => row.year < life.end_year).map(row => row.year),
    ...life.evidence.commands.flatMap(command => command.logs.filter(log => log.type === 'event' || log.type === 'draw').map(log => log.calendar_year)),
  ])];
  const progress = globalProgress(life, mappings);
  rows.push({ seed: life.seed, strategy: life.strategy, start_age: life.start_age, end_age: life.end_age, reached_year_10: life.reached_year_10, ...progress });
}
const summary = Object.fromEntries(['all', 'normal', 'cautious', 'risky', 'career'].map(strategy => {
  const group = rows.filter(row => row.reached_year_10 && (strategy === 'all' || row.strategy === strategy));
  return [strategy, { n: group.length, whole_p90: percentile(group.map(row => row.whole_gap), .9), active_p90: percentile(group.map(row => row.active_gap), .9), active_over_six: group.filter(row => row.active_gap > 6).map(row => ({ seed: row.seed, strategy: row.strategy, gap: row.active_gap })) }];
}));
writeFileSync(output, JSON.stringify({ familyMilestones, mappings, summary, rows }, null, 2), { flag: 'wx' });
console.log(JSON.stringify(summary, null, 2));
