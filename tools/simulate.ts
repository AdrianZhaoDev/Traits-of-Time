import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { GameEngine } from '../assets/scripts/core/engine/GameEngine.js';
import { GachaEngine } from '../assets/scripts/core/engine/GachaEngine.js';
import type { Condition } from '../assets/scripts/core/types/content.generated.js';
import { recordCommand, type ReplayAction, type ReplayCommand } from '../assets/scripts/application/ReplayCommands.js';
import { loadContent } from './lib/ContentLoader.js';
import { buildInitializationFailureReplay, buildReplay, writeReplay } from './lib/Replay.js';
import { sha256 } from './lib/canonical.js';
import { DrawStatistics, LifeStatistics } from './lib/SimulationReport.js';
import { ArgumentError, DEFAULT_CONTENT, DEFAULT_SEED, assertDestinationOutsideContent, errorDetails, integerArg, parseCli, requiredString, runCli } from './lib/cli.js';

function hasModernCardGate(condition: Condition | undefined): boolean {
  if (!condition) return false;
  if (condition.op === 'has') return condition.collection === 'cards' && condition.id.startsWith('CARD_MOD_');
  if (condition.op === 'all' || condition.op === 'any') return condition.conditions.some(hasModernCardGate);
  return false;
}

await runCli(async () => {
  const args = parseCli({ mode: { type: 'string' }, content: { type: 'string' }, runs: { type: 'string' },
    seed: { type: 'string' }, strategy: { type: 'string' }, pool: { type: 'string' },
    'draws-per-run': { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } });
  const mode = args.mode ?? 'life';
  if (mode !== 'life' && mode !== 'draw') throw new ArgumentError('--mode 必须是 life 或 draw');
  const strategy = args.strategy ?? 'normal';
  if (strategy !== 'normal' && strategy !== 'cautious' && strategy !== 'risky' && strategy !== 'reaction') throw new ArgumentError('--strategy 必须是 normal、cautious、risky 或 reaction');
  if (mode === 'draw' && args.strategy !== undefined) throw new ArgumentError('draw 模式不接受 --strategy');
  if (mode === 'life' && (args.pool !== undefined || args['draws-per-run'] !== undefined)) throw new ArgumentError('life 模式不接受 --pool 或 --draws-per-run');
  const runs = integerArg(requiredString(args, 'runs'), 'runs', 1);
  const seed = integerArg(args.seed ?? String(DEFAULT_SEED), 'seed', 0, 0xffffffff);
  if (runs - 1 > 0xffffffff - seed) throw new ArgumentError('seed + runs - 1 超出 uint32 范围');
  const contentDirectory = typeof args.content === 'string' ? args.content : DEFAULT_CONTENT;
  const output = resolve(requiredString(args, 'out'));
  const poolId = mode === 'draw' ? requiredString(args, 'pool') : undefined;
  const draws = mode === 'draw' ? integerArg(requiredString(args, 'draws-per-run'), 'draws-per-run', 1) : undefined;
  await assertDestinationOutsideContent(contentDirectory, output);
  const { bundle, fingerprint } = await loadContent(contentDirectory);
  const pool = mode === 'draw' ? bundle.pools.find(item => item.id === poolId) : undefined;
  if (mode === 'draw' && !pool) throw Object.assign(new Error(`卡池不存在：${poolId}`), { code: 'POOL_NOT_FOUND' });
  if (pool && !pool.replacement && draws! > pool.entries.filter(entry => entry.weight > 0).length) {
    throw Object.assign(new Error('无放回抽数超过正权重卡数量'), { code: 'INSUFFICIENT_CANDIDATES' });
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Exclusive directory creation: never replace user reports.
  await mkdir(join(output, 'traces'));
  const stream = await open(join(output, 'runs.jsonl'), 'wx');
  const lifeStats = new LifeStatistics(bundle);
  const drawStats = pool ? new DrawStatistics(bundle, pool) : undefined;
  const events = new Map(bundle.events.map(event => [event.id, event]));
  let success = 0;
  let failed = 0;
  try {
    for (let index = 0; index < runs; index++) {
      const runSeed = seed + index;
      const commands: ReplayCommand[] = [];
      const engine = mode === 'life' ? new GameEngine(bundle, fingerprint) : new GachaEngine(bundle, fingerprint, runSeed);
      let blockingInputs = 1;
      let initialized = engine instanceof GachaEngine;
      let record: Record<string, unknown>;
      try {
        if (engine instanceof GachaEngine) {
          const executed = recordCommand(engine, { api: 'draw', commandId: 'simulate:0', args: { poolId: poolId!, count: draws! } }, sha256);
          commands.push(executed.command);
          if ('ok' in executed.result) {
            if (!executed.result.ok) throw Object.assign(new Error(executed.result.error.message), { code: executed.result.error.code });
            throw new Error('抽卡返回了人生结果');
          }
          drawStats!.add(executed.result);
          record = { index, seed: runSeed, status: 'ended', misses: executed.result.items.at(-1)!.pity_after };
        } else {
          let action: ReplayAction = { api: 'initGame', commandId: 'simulate:0', args: { seed: runSeed } };
          while (true) {
            const executed = recordCommand(engine, action, sha256);
            commands.push(executed.command);
            const result = executed.result;
            if (!('ok' in result)) throw new Error('人生返回了抽卡结果');
            if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
            initialized = true;
            // Opening plus explicit choices; authorized D20 resolution is not a user input.
            if (action.api === 'resolveOption') blockingInputs++;
            if (result.state.status === 'ENDED') break;
            if (commands.length >= 100_000) throw Object.assign(new Error('单局达到 100000 条命令，未结束'), { code: 'SIMULATION_COMMAND_LIMIT' });
            const commandId = `simulate:${commands.length}`;
            const pending = result.pending;
            if (pending?.kind === 'stage') {
              action = { api: 'resolveStage', commandId, args: { eventInstanceId: pending.event_instance_id, stageId: pending.stage_id } };
            } else if (pending?.kind === 'option') {
              const event = events.get(pending.event_id);
              if (event?.interaction !== 'choice') throw new Error('待选择事件不存在');
              const available = new Set(pending.options.filter(option => option.available).map(option => option.id));
              const eligible = event.options.filter(option => available.has(option.id));
              const risks = strategy === 'cautious' ? ['safe', 'normal', 'high'] : ['high', 'normal', 'safe'];
              const option = strategy === 'reaction' ? eligible.find(item => hasModernCardGate(item.condition)) ?? eligible[0]
                : strategy === 'normal' ? eligible[0] : risks.flatMap(risk => eligible.filter(item => item.risk === risk))[0];
              if (!option) throw Object.assign(new Error('当前事件没有合法选项'), { code: 'SIMULATION_NO_PROGRESS' });
              action = { api: 'resolveOption', commandId, args: { eventInstanceId: pending.event_instance_id, optionId: option.id } };
            } else if (result.state.status === 'READY') {
              action = { api: 'nextYear', commandId, args: {} };
            } else throw Object.assign(new Error('当前状态没有合法推进命令'), { code: 'SIMULATION_NO_PROGRESS' });
          }
          const report = engine.generateEndingReport();
          const stratum = lifeStats.add(report, engine.exportSave(), blockingInputs);
          record = { index, seed: runSeed, status: 'ended', report, blocking_inputs: blockingInputs,
            estimated_input_seconds: blockingInputs * 5, ...stratum };
        }
        success++;
      } catch (error) {
        failed++;
        const save = initialized ? engine.exportSave() : null;
        record = { index, seed: runSeed, status: 'failed', error: errorDetails(error), save,
          ...(mode === 'life' ? { blocking_inputs: blockingInputs, estimated_input_seconds: blockingInputs * 5,
            player_decisions: save?.kind === 'life' ? save.payload.logs.reduce((count, log) => count + Number(log.type === 'option'), 0) : 0 } : {}) };
      }
      const trace = initialized ? buildReplay(engine, commands)
        : buildInitializationFailureReplay(bundle, fingerprint, runSeed, commands[0]!);
      await writeReplay(join(output, 'traces', `${index}.json`), trace);
      await stream.writeFile(`${JSON.stringify(record)}\n`);
    }
  } finally { await stream.close(); }
  const summary = { mode, content_id: bundle.manifest.content_id, content_version: bundle.manifest.content_version,
    content_fingerprint: fingerprint, seed, seed_end: seed + runs - 1, runs, success, failed,
    ...(mode === 'life' ? { strategy, life: lifeStats.summary(), estimated_input_seconds_note: '按每次阻塞输入 5 秒估算，不是实际游玩时长' }
      : { draw: drawStats!.summary(), probability_note: 'base_probability 是原始权重比例；实验频率受保底或无放回影响，不等同于基础概率' }) };
  await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  if (args.json) process.stdout.write(`${JSON.stringify(summary)}\n`);
  else process.stdout.write(`模拟完成：seed=${seed}–${seed + runs - 1}，${runs} 局，成功 ${success}，失败 ${failed}。报告：${output}\n`);
  if (failed > 0) process.exitCode = 1;
});
