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
    let engine = new GameEngine(bundle, fingerprint);
    let session = new GameSession(engine, { persist: value => save(directory, value), load: () => load<SessionSave>(directory), hash: sha256 });
    let initialized = false;
    const stored = await load<SessionSave>(directory);
    if (stored) {
      try {
        session.restoreSave(stored);
        if (seed !== undefined) checkSeed(true, seed, stored.engine.payload.run.seed);
        // Auto-restart only in default interactive development state when explicitly requested or ended
        const isDefaultDevState = directory === '.local-state/life';
        if (session.current().state.status === 'ENDED' && isDefaultDevState) {
          console.log(styleText('yellow', '【提示】上一局人生已落幕，已自动为您重开全新一世人生！'));
          initialized = false;
        } else {
          initialized = true;
        }
      } catch (err: unknown) {
        const code = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : undefined;
        const isDefaultDevState = directory === '.local-state/life';
        if (isDefaultDevState && (code === 'CONTENT_MISMATCH' || code === 'SAVE_INVALID' || code === 'SEED_MISMATCH')) {
          console.log(styleText('yellow', `[提示] 检测到旧存档内容指纹或配置发生变化（${code}），已自动为您开启新一局游戏。`));
        } else {
          throw err;
        }
      }
    }
    if (!initialized) {
      engine = new GameEngine(bundle, fingerprint);
      session = new GameSession(engine, { persist: value => save(directory, value), load: () => load<SessionSave>(directory), hash: sha256 });
      const result = await session.initialize(seed ?? randomInt(0, 2 ** 32));
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    let shownLog = 0;
    let currentYearShown: number | null = null;
    const narrative = (text: string) => styleText('cyan', text, { stream: process.stdout });
    const header = (text: string) => styleText('bold', styleText('yellow', text, { stream: process.stdout }), { stream: process.stdout });
    const showCard = (id: string) => {
      const card = bundle.cards.find(item => item.id === id)!;
      console.log(styleText('green', `【随身神物】${card.name} [${card.rarity}]（${card.description}）`));
    };
    const show = () => {
      const snapshot = session.exportSave();
      const { state, pending } = session.current();
      let pendingEventShown = false;
      for (const entry of snapshot.engine.payload.logs) {
        if (entry.seq <= shownLog) continue;
        shownLog = entry.seq;
        // Filter out draw audits, audit summaries, and internal condition checks
        if (entry.type === 'draw') continue;
        if (entry.message.startsWith('CONDITION_NOT_MET') || entry.message.includes('×')) continue;
        
        if (currentYearShown !== entry.calendar_year) {
          currentYearShown = entry.calendar_year;
          console.log(`\n━━━━━━━━━━━━━━━━【${entry.calendar_year}年 · ${entry.age}岁】━━━━━━━━━━━━━━━━`);
        }
        if (entry.type === 'opening') {
          console.log(`【出身启程】${narrative(entry.message)}`);
          showCard(entry.data.card_id);
        } else if (entry.type === 'event') {
          if (entry.data.event_instance_id === pending?.event_instance_id) pendingEventShown = true;
          console.log(`【发生事件】${narrative(entry.message)}`);
        } else if (entry.type === 'dice') {
          console.log(styleText('magenta', `  🎲 掷骰检定：D20=${entry.data.raw} + 属性=${entry.data.attribute_value} (修正${entry.data.modifier_after}) vs DC=${entry.data.dc} → ${entry.data.success ? '成功' : '失败'}`));
        } else if (entry.type === 'effects') {
          for (const effect of entry.data.effects) {
            if (effect.type === 'attribute_add') {
              console.log(styleText('gray', `  ✦ 属性变动：${effect.attribute} ${effect.amount >= 0 ? '+' : ''}${effect.amount}`));
            }
          }
        } else if (entry.type === 'death') {
          console.log(styleText('red', `【走向终局】${entry.message}`));
        } else if (entry.type === 'achievement') {
          console.log(styleText('yellow', `★ 达成成就：${entry.message}`));
        } else {
          console.log(`  ${entry.message}`);
        }
      }
      const p = state.player;
      const fictional = p.calendar_year - bundle.era.historical_end_year;
      const statusStr = state.timeline === 'historical' ? '历史推进' : fictional > 0 ? `架空延续第 ${fictional} 年` : '架空推演';
      console.log(styleText('gray', `[${p.calendar_year}年·${p.age}岁 | ${bundle.era.identities.find(item => item.id === p.identity_id)?.name} | 属性: 体${p.attributes.physique} 智${p.attributes.intelligence} 富${p.attributes.wealth} 声${p.attributes.prestige} 运${p.attributes.luck} | 状态: ${statusStr}]`));
      if (pending) {
        if (!pendingEventShown) console.log(`【事件抉择】${narrative(bundle.events.find(event => event.id === pending.event_id)!.text)}`);
        if (pending.kind === 'option') {
          console.log(header('【你的决策】'));
          pending.options.forEach((option, idx) => {
            const num = styleText('bold', styleText('yellow', `[${idx + 1}]`));
            const hint = option.available ? styleText('green', '可选') : styleText('red', `不可选(${option.reason})`);
            console.log(`  👉 输入 ${num} 或 choose ${option.id}  ——  ${option.text} [${hint}]`);
          });
        } else {
          console.log(`${narrative(pending.text)}\n阶段 ${pending.stage_id}：${pending.check.attribute} / DC ${pending.check.dc}；${args.auto ? '全自动模式将自动确认掷骰。' : '输入 stage 确认掷骰。'}`);
        }
      }
      if (state.status === 'ENDED') {
        const report = engine.generateEndingReport();
        console.log(styleText('red', '\n════════════════════ 人生谢幕 ════════════════════'));
        console.log(`【主线结局】${report.primary_achievement_id === null ? '普通人生' : bundle.achievements.find(item => item.id === report.primary_achievement_id)?.name}；${report.death_id === null ? '主动谢幕' : bundle.deaths.find(item => item.id === report.death_id)?.name}`);
        console.log(`【享年寿命】终止年龄：${report.end_age} 岁（历经 ${report.years_played} 载风雨）`);
        console.log(`【最终身份】${bundle.era.identities.find(item => item.id === report.highest_identity_id)?.name}`);
        console.log(styleText('yellow', '本局已结束。输入 npm run play 即可开启新人生！\n'));
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
      console.log('命令：输入序号 1/2/3 快速选择 / next (推进) / auto / stage / status / quit');
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
          if (text === 'next' && session.current().pending) { console.log('请先输入序号选择当前选项，或输入 stage 确认阶段。'); continue; }
          let result: CommandResult;
          const currentPending = session.current().pending;
          if (/^\d+$/.test(text) && currentPending?.kind === 'option') {
            const index = Number(text) - 1;
            const option = currentPending.options[index];
            if (!option) {
              console.log(`无效序号。请输入 1 到 ${currentPending.options.length} 之间的数字。`);
              continue;
            }
            result = await session.command({ type: 'choose', optionId: option.id });
          } else if (text === 'auto') result = await session.advanceToDecision(`life-auto:${session.exportSave().engine.revision}:${session.exportSave().cursor.input_sequence}`);
          else if (text === 'next' || text === 'stage' || text === 'retire') result = await session.command({ type: text });
          else if (text.startsWith('choose ') && text.slice(7).length > 0) result = await session.command({ type: 'choose', optionId: text.slice(7) });
          else { console.log('未知命令。直接输入数字 1/2/3 进行抉择，或输入 next / auto / stage / status / quit。'); continue; }
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
