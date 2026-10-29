import { createInterface, type Interface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { GameEngine } from '../assets/scripts/core/engine/GameEngine.js';
import { GameSession, type SessionSave } from '../assets/scripts/application/GameSession.js';
import type { CommandResult } from '../assets/scripts/core/types/commands.js';
import { loadContent } from './lib/ContentLoader.js';
import { load, save } from './lib/FileStateStore.js';
import { sha256 } from './lib/canonical.js';
import { chooseAutomaticOption } from './lib/AutoPlay.js';
import { buildReplay, writeReplay } from './lib/Replay.js';
import { DEFAULT_CONTENT, parseCli, requiredString, integerArg, assertDestinationOutsideContent, checkSeed, withStateLock, runCli } from './lib/cli.js';

await runCli(async () => {
  const args = parseCli({ content: { type: 'string', default: DEFAULT_CONTENT }, seed: { type: 'string' }, state: { type: 'string', default: '.local-state/life' }, 'export-replay': { type: 'string' }, auto: { type: 'boolean', default: false } });
  const directory = requiredString(args, 'state');
  const contentDirectory = requiredString(args, 'content');
  const exportFile = args['export-replay'] === undefined ? undefined : requiredString(args, 'export-replay');
  const seed = args.seed === undefined ? undefined : integerArg(args.seed, 'seed', 0, 0xffffffff);
  const { bundle, fingerprint } = await loadContent(contentDirectory);
  await assertDestinationOutsideContent(contentDirectory, directory);
  if (exportFile !== undefined) await assertDestinationOutsideContent(contentDirectory, exportFile);
  let lines: Interface | undefined;
  await withStateLock(directory, async interrupted => {
    const engine = new GameEngine(bundle, fingerprint);
    const session = new GameSession(engine, { persist: value => save(directory, value), load: () => load<SessionSave>(directory), hash: sha256 });
    const stored = await load<SessionSave>(directory);
    if (stored) {
      session.restoreSave(stored);
      if (seed !== undefined) checkSeed(true, seed, stored.engine.payload.run.seed);
    } else {
      const result = await session.initialize(seed ?? randomInt(0, 2 ** 32));
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    let shownLog = 0;
    const narrative = (text: string) => styleText('cyan', text, { stream: process.stdout });
    const showCard = (id: string) => {
      const card = bundle.cards.find(item => item.id === id)!;
      console.log(`随身物品：${card.name} [${card.rarity}]（${card.id}）\n${card.description}`);
    };
    const show = () => {
      const snapshot = session.exportSave();
      const { state, pending } = session.current();
      let pendingEventShown = false;
      for (const entry of snapshot.engine.payload.logs) {
        if (entry.seq <= shownLog) continue;
        shownLog = entry.seq;
        // Selection audits share event text but do not mean the event has executed.
        if (entry.type === 'draw' && entry.data.selected_event_id !== null) continue;
        console.log(`[${entry.calendar_year}年 / ${entry.age}岁] ${narrative(entry.message)}`);
        if (entry.type === 'opening') showCard(entry.data.card_id);
        if (entry.type === 'event' && entry.data.event_instance_id === pending?.event_instance_id) pendingEventShown = true;
        if (entry.type === 'dice') console.log(`D20=${entry.data.raw}；属性=${entry.data.attribute_value}；修正=${entry.data.modifier_before}→${entry.data.modifier_after}；DC=${entry.data.dc}；${entry.data.success ? '成功' : '失败'}；本阶段成功率=${entry.data.success_probability * 100}%`);
        if (entry.type === 'effects') for (const effect of entry.data.effects) if (effect.type === 'attribute_add') console.log(`属性变化 ${effect.attribute}: ${effect.amount >= 0 ? '+' : ''}${effect.amount}（按配置边界截断）`);
      }
      const p = state.player;
      const fictional = p.calendar_year - bundle.era.historical_end_year;
      console.log(`\n${p.calendar_year}年 / ${p.age}岁 ${state.timeline === 'historical' ? '历史窗口' : fictional > 0 ? `架空延续第 ${fictional} 年` : '架空推演'}；状态 ${state.status}`);
      console.log(`身份：${bundle.era.identities.find(item => item.id === p.identity_id)?.name}；地区：${bundle.regions.find(item => item.id === p.region_id)?.name}；门第：${bundle.castes.find(item => item.id === p.caste_id)?.name}`);
      for (const id of p.cards) showCard(id);
      console.log(`属性：${Object.entries(p.attributes).map(([key, value]) => `${key}=${value}`).join(' / ')}`);
      for (const chain of p.chains) console.log(`任务：${bundle.chains.find(item => item.id === chain.chain_id)?.name} ${chain.status}，节点 ${chain.node_index}，到期年 ${chain.next_due_year ?? '无'}${chain.interruption_reason ? `，原因 ${chain.interruption_reason}` : ''}`);
      for (const id of p.achievements) console.log(`成就：${bundle.achievements.find(item => item.id === id)?.name}`);
      if (pending) {
        if (!pendingEventShown) console.log(narrative(bundle.events.find(event => event.id === pending.event_id)!.text));
        if (pending.kind === 'option') for (const option of pending.options) console.log(`choose ${option.id} — ${option.text} [${option.available ? '可选' : `不可选：${option.reason}`} ]`);
        else console.log(`${narrative(pending.text)}\n阶段 ${pending.stage_id}：${pending.check.attribute} / DC ${pending.check.dc}；${args.auto ? '全自动模式将自动确认掷骰。' : '输入 stage 明确确认掷骰。'}`);
      }
      if (state.status === 'ENDED') {
        const report = engine.generateEndingReport();
        console.log(`结局：${report.primary_achievement_id === null ? '普通人生' : bundle.achievements.find(item => item.id === report.primary_achievement_id)?.name}；${report.death_id === null ? '主动谢幕' : bundle.deaths.find(item => item.id === report.death_id)?.name}`);
        console.log(`游玩年数：${report.years_played}；终止年龄：${report.end_age}；最高身份：${bundle.era.identities.find(item => item.id === report.highest_identity_id)?.name}`);
        console.log('本局已结束。使用新的 --state 目录可免费重开；原存档不会删除。');
      }
    };
    console.log(`种子：${session.exportSave().engine.payload.run.seed}\n内容指纹：${fingerprint}\n存档：${resolve(directory)}`);
    show();
    if (args.auto) {
      console.log('全自动模式：随机选择可用选项、确认阶段并逐年推进至结局；Ctrl+C 可在当前命令保存后停止。');
      while (!interrupted()) {
        const { state, pending } = session.current();
        if (state.status === 'ENDED') break;
        let result: CommandResult;
        let action: string;
        if (pending?.kind === 'option') {
          const optionId = chooseAutomaticOption(pending);
          result = await session.command({ type: 'choose', optionId });
          action = `随机选择：${optionId}`;
        } else if (pending?.kind === 'stage') {
          result = await session.command({ type: 'stage' });
          action = `自动确认阶段：${pending.stage_id}`;
        } else if (state.status === 'READY') {
          result = await session.command({ type: 'next' });
          action = '自动推进一年';
        } else {
          throw Object.assign(new Error('当前状态无法继续自动运行'), { code: 'INVALID_STATE' });
        }
        if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        console.log(action);
        show();
      }
    } else if (session.current().state.status !== 'ENDED' && !interrupted()) {
      console.log('命令：status / next / auto / choose <optionId> / stage / retire / save / quit');
      lines = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
      try {
        for await (const input of lines) {
          if (interrupted()) break;
          const text = input.startsWith('choose ') ? input : input.trim();
          if (!text) continue;
          if (text === 'quit') break;
          if (text === 'status') { show(); continue; }
          if (text === 'save') {
            await save(directory, session.exportSave());
            // Report the actual durable slot revision, not only the engine revision.
            const revisions = await Promise.all(['slot-a.json', 'slot-b.json'].map(async name => {
              try {
                const slot = JSON.parse(await readFile(join(directory, name), 'utf8')) as { revision: number; payload: unknown; checksum: string };
                return slot.checksum === sha256(slot.payload) && Number.isSafeInteger(slot.revision) ? slot.revision : 0;
              } catch { return 0; }
            }));
            console.log(`已保存；文件版本 ${Math.max(...revisions)}；引擎版本 ${session.current().state.revision}`);
            continue;
          }
          if (session.current().state.status === 'ENDED') { show(); continue; }
          if ((text === 'next' || text === 'auto') && session.current().pending) { console.log('请先选择当前选项或输入 stage 确认阶段。'); continue; }
          let result: CommandResult;
          if (text === 'auto') result = await session.advanceToDecision(`life-auto:${session.exportSave().engine.revision}:${session.exportSave().cursor.input_sequence}`);
          else if (text === 'next' || text === 'stage' || text === 'retire') result = await session.command({ type: text });
          else if (text.startsWith('choose ') && text.slice(7).length > 0) result = await session.command({ type: 'choose', optionId: text.slice(7) });
          else { console.log('未知命令。使用 status / next / auto / choose <optionId> / stage / retire / save / quit。'); continue; }
          if (!result.ok) process.stderr.write(`错误 [${result.error.code}] ${result.error.message}\n`);
          show();
        }
      } finally { lines.close(); }
    }
    if (exportFile !== undefined && !interrupted()) {
      await writeReplay(exportFile, buildReplay(engine, session.exportSave().replay_commands));
      console.log(`已导出回放：${resolve(exportFile)}`);
    }
  }, () => lines?.close());
});
