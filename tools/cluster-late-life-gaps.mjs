import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const [input, report, output, minimumArg = '7', maximumArg = 'Infinity'] = process.argv.slice(2);
if (!input || !report || !output) throw Error('Usage: cluster-late-life-gaps.mjs INPUT.jsonl GLOBAL.json OUTPUT.json [MINIMUM] [MAXIMUM]');
const minimum = Number(minimumArg), maximum = Number(maximumArg);
const target = new Map(JSON.parse(readFileSync(report, 'utf8')).rows.filter(row => row.reached_year_10 && row.active_gap >= minimum).map(row => [`${row.strategy}:${row.seed}`, row]));
const cases = [], clusters = {};
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const life = JSON.parse(line), metrics = target.get(`${life.strategy}:${life.seed}`);
  if (!metrics) continue;
  const progress = new Set(metrics.progress_years), gaps = [];
  let begin = null;
  const years = life.evidence.exposed_years.filter(year => year >= life.start_year + 9 && year < metrics.settlement_year).sort((a,b) => a-b);
  for (const year of [...years, Infinity]) {
    if (year !== Infinity && !progress.has(year)) { if (begin === null) begin = year; }
    else if (begin !== null) { const end = year === Infinity ? years.at(-1) : year - 1; if (end-begin+1>=minimum && end-begin+1<=maximum) gaps.push({begin,end}); begin = null; }
  }
  for (const gap of gaps) {
    const commands = life.evidence.commands.filter(command => command.year >= gap.begin && command.year <= gap.end);
    const events = commands.flatMap(command => command.logs.filter(log => log.type === 'event' && log.source_id.startsWith('E_LL_')).map(log => ({year:log.calendar_year,event_id:log.source_id,text:log.message,wealth:command.before.attributes.wealth,identity:command.before.identity_id,flags:command.before.flags,chains:command.before.chains})));
    const ids = events.map(event => event.event_id);
    const mechanisms = [];
    if (ids.some(id => id.includes('WORK_NO_CAREER') || id.includes('WORK_RETURN_NO_CAREER'))) mechanisms.push('work_without_completed_career_or_supplier');
    if (ids.some(id => id.includes('CHANGED') || id.includes('LOST') || id.includes('RECOVERED'))) mechanisms.push('state_change_or_relationship_loss');
    if (ids.some(id => id.includes('BREAD_WEALTHY'))) mechanisms.push('wealthy_bread_maintenance');
    if (ids.some(id => id.includes('CARE_OTHER'))) mechanisms.push('healthy_care_maintenance');
    if (ids.some(id => id.includes('CREDIT_'))) mechanisms.push('credit_maintenance');
    if (!mechanisms.length) mechanisms.push('other_requires_event_review');
    for (const mechanism of mechanisms) { const entries=clusters[mechanism]??=[]; entries.push({seed:life.seed,strategy:life.strategy,begin:gap.begin,end:gap.end}); clusters[mechanism]=entries; }
    cases.push({seed:life.seed,strategy:life.strategy,start_age:life.start_age,...gap,mechanisms,events});
  }
}
writeFileSync(output,JSON.stringify({classification:'Nonexclusive observed event mechanisms, not proof of counterfactual eligibility',clusters,cases},null,2),{flag:'wx'});
console.log(Object.fromEntries(Object.entries(clusters).map(([key,value])=>[key,{n:value.length,representatives:value.slice(0,3)}])));
