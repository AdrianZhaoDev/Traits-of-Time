import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [rootArg, input, output] = process.argv.slice(2);
if (!rootArg || !input || !output) throw Error('Usage: node --import ./tools/register-typescript.mjs tools/late-life-budget.mjs ROOT INPUT.jsonl OUTPUT.json');
const root = resolve(rootArg);
const { conditionContext, evaluateCondition } = await import(pathToFileURL(resolve(root, 'src/game/core/engine/ConditionEvaluator.ts')));
const events = JSON.parse(readFileSync(resolve(root, 'assets/resources/data/ming_end/events.json'), 'utf8'));
// Only time bounds are removed for the counterfactual; earned prerequisites and spent-category flags remain.
function withoutTime(condition) {
  if (!condition) return condition;
  if (condition.op === 'compare' && ['calendar_year', 'years_elapsed'].includes(condition.field)) return { op: 'all', conditions: [] };
  if (condition.op === 'all' || condition.op === 'any') return { ...condition, conditions: condition.conditions.map(withoutTime) };
  if (condition.op === 'not') return { ...condition, condition: withoutTime(condition.condition) };
  return condition;
}
const rows = [];
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const life = JSON.parse(line);
  if (life.category_budget_exhausted_at_year_10 !== false) continue;
  const applicable = new Map(), timeBlocked = new Map();
  for (const snapshot of life.evidence.year_states.filter(row => row.year >= life.start_year + 9)) {
    const player = snapshot.player;
    const context = conditionContext(player, snapshot.year > 1645 ? 'fictional' : 'historical');
    for (const event of events.filter(event => event.interaction === 'choice' && event.trigger.kind === 'random')) {
      if (!event.options.some(option => evaluateCondition(option.condition, context))) continue;
      const eligible = evaluateCondition(event.condition, context);
      if (eligible) applicable.set(event.id, [...(applicable.get(event.id) ?? []), snapshot.year]);
      else if (evaluateCondition(withoutTime(event.condition), context)) timeBlocked.set(event.id, [...(timeBlocked.get(event.id) ?? []), snapshot.year]);
    }
  }
  rows.push({ strategy: life.strategy, seed: life.seed, late_choices: life.late_successful_choices,
    category: life.late_successful_choices ? 'used_late_opportunity' : applicable.size ? 'state_applicable' : timeBlocked.size ? 'time_locked_earned_path' : 'formal_budget_no_path_in_year_end_sample',
    applicable: Object.fromEntries(applicable), time_locked: Object.fromEntries(timeBlocked) });
}
const categories = Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => [category, rows.filter(row => row.category === category).length]));
writeFileSync(output, JSON.stringify({ definitions: { state_applicable: 'Event and at least one option conditions hold in a yearly end-state; costs, weights, cooldowns and death timing still require scheduler review.', time_locked: 'Removing only calendar/elapsed conditions opens an otherwise earned random-choice path; not automatic entitlement to another choice.', formal_budget: 'No matching random-choice path in observed yearly end-states; chain endpoints are represented by actual late choices.' }, categories, rows }, null, 2), { flag: 'wx' });
console.log(categories);
