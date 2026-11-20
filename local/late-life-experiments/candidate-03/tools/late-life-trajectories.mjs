import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node tools/late-life-trajectories.mjs INPUT.jsonl OUTPUT.json');
const selected = {};
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const life = JSON.parse(line);
  const state = life.evidence.year_10_state;
  const route = state?.late_life?.route_id;
  const categories = [];
  if (route === 'prosperous_power' || route === 'prosperous_free') categories.push('prosperous');
  if (route === 'struggling' || route === 'hardship') categories.push('poor');
  if (route === 'poor_renowned') categories.push('poor_renowned');
  if (life.start_age <= 10 && life.reached_year_10) categories.push('young_plus_nine');
  if (life.chain_results.some(row => row.action === 'interrupted') && life.reached_year_10) categories.push('interrupted');
  if (life.end_age >= 90 && life.end_year - life.start_year >= 40) categories.push('long_lived');
  for (const category of categories) {
    if (selected[category]) continue;
    selected[category] = { source: life.targeted_card ? 'targeted_card_scenario' : 'natural_production_seed', seed: life.seed, strategy: life.strategy, card: life.card, start_age: life.start_age, end_age: life.end_age, route,
      years: life.evidence.year_states.map(snapshot => ({ year: snapshot.year, age: snapshot.player.age, attributes: snapshot.player.attributes, identity: snapshot.player.identity_id, late_life: snapshot.player.late_life,
        entries: life.evidence.commands.filter(command => command.year === snapshot.year).flatMap(command => command.logs).filter(log => !['draw', 'follow_up'].includes(log.type)).map(log => ({ type: log.type, source_id: log.source_id, text: log.message, data: log.data })) })) };
  }
}
const required = ['prosperous', 'poor', 'poor_renowned', 'young_plus_nine', 'interrupted', 'long_lived'];
writeFileSync(output, JSON.stringify({ source_file: input, missing_categories: required.filter(category => !selected[category]), trajectories: selected }, null, 2), { flag: 'wx' });
console.log({ selected: Object.keys(selected), missing: required.filter(category => !selected[category]) });
