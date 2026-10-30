import { createInterface, type Interface } from 'node:readline';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
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

const attributeNames = { physique: '体魄', intelligence: '智力', wealth: '财富', prestige: '声望', luck: '运气' };
const riskNames = { safe: '安全', normal: '普通', high: '高风险' };

await runCli(async () => {
  const args = parseCli({ content: { type: 'string', default: DEFAULT_CONTENT }, seed: { type: 'string' }, state: { type: 'string' }, new: { type: 'boolean', default: false }, 'export-replay': { type: 'string' }, auto: { type: 'boolean', default: false } });
  let directory = args.state === undefined ? '.local-state/life' : requiredString(args, 'state');
  const contentDirectory = requiredString(args, 'content');
  const exportFile = args['export-replay'] === undefined ? undefined : requiredString(args, 'export-replay');
  const seed = args.seed === undefined ? undefined : integerArg(args.seed, 'seed', 0, 0xffffffff);
  const { bundle, fingerprint } = await loadContent(contentDirectory);
  await assertDestinationOutsideContent(contentDirectory, directory);
  if (exportFile !== undefined) await assertDestinationOutsideContent(contentDirectory, exportFile);
  if (args.new && args.state === undefined) {
    const parent = '.local-state';
    await assertDestinationOutsideContent(contentDirectory, parent);
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'life-'));
  }
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const contentArgument = /^https:\/\//i.test(contentDirectory) ? contentDirectory : resolve(contentDirectory);
  const newCommand = `npm run play -- --new --content ${quote(contentArgument)}`;
  let lines: Interface | undefined;
  await withStateLock(directory, async interrupted => {
    const engine = new GameEngine(bundle, fingerprint);
    const session = new GameSession(engine, { persist: value => save(directory, value), load: () => load<SessionSave>(directory), hash: sha256 });
    if (args.new && (await readdir(directory)).some(name => name === 'slot-a.json' || name === 'slot-b.json')) {
      throw Object.assign(new Error(`该目录已有存档，不能覆盖。另开一局：${newCommand}`), { code: 'STATE_EXISTS' });
    }
    const stored = await load<SessionSave>(directory);
    if (stored) {
      try {
        session.restoreSave(stored);
        if (seed !== undefined) checkSeed(true, seed, stored.engine.payload.run.seed);
      } catch (error) {
        if (error instanceof Error) error.message += `；旧档已保留。另开一局：${newCommand}`;
        throw error;
      }
    } else {
      const result = await session.initialize(seed ?? randomInt(0, 2 ** 32));
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    let shownLog = stored ? (stored.engine.payload.logs.at(-1)?.seq ?? 0) : 0;
    let currentYearShown: number | null = null;
    const narrative = (text: string) => styleText('cyan', text, { stream: process.stdout });
    const header = (text: string) => styleText('bold', styleText('yellow', text, { stream: process.stdout }), { stream: process.stdout });
    const showCard = (id: string, restored = false) => {
      const card = bundle.cards.find(item => item.id === id)!;
      console.log(styleText('green', `【${restored ? '开局携带（不代表当前可用）' : '随身物品'}】${card.name} [${card.rarity}]（${card.description}）`));
    };
    const show = () => {
      const snapshot = session.exportSave();
      const { state, pending } = session.current();
      let pendingEventShown = false;
      for (const entry of snapshot.engine.payload.logs) {
        if (entry.seq <= shownLog) continue;
        shownLog = entry.seq;
        // Audit records are internal; narrative text never determines visibility.
        if (entry.type === 'draw' || entry.type === 'skip') continue;
        
        if (currentYearShown !== entry.calendar_year) {
          currentYearShown = entry.calendar_year;
          console.log(`\n━━━━━━━━━━━━━━━━【${entry.calendar_year}年 · ${entry.age}岁】━━━━━━━━━━━━━━━━`);
        }
        if (entry.type === 'opening') {
          console.log(`【出身启程】${narrative(entry.message)}`);
          showCard(entry.data.card_id);
        } else if (entry.type === 'event') {
          if (entry.data.event_instance_id === pending?.event_instance_id) pendingEventShown = true;
          console.log(`${narrative(entry.message)}`);
        } else if (entry.type === 'dice') {
          console.log(styleText('magenta', `  🎲 掷骰检定：D20=${entry.data.raw} + 属性=${entry.data.attribute_value} (修正${entry.data.modifier_after}) vs DC=${entry.data.dc} → ${entry.data.success ? '成功' : '失败'}`));
        } else if (entry.type === 'effects') {
          if (entry.message) console.log(`↳ ${narrative(entry.message)}`);
          for (const effect of entry.data.effects) {
            if (effect.type === 'attribute_add') {
              console.log(styleText('gray', `  属性变动：${attributeNames[effect.attribute]} ${effect.amount >= 0 ? '+' : ''}${effect.amount}`));
            } else if (effect.type === 'injury_add' || effect.type === 'injury_remove') {
              console.log(`  ${effect.type === 'injury_add' ? '伤病增加' : '伤病移除'}：${bundle.era.injuries.find(item => item.id === effect.id)?.name}`);
            } else if (effect.type === 'identity_set') {
              console.log(`  身份变更：${bundle.era.identities.find(item => item.id === effect.id)?.name}`);
            } else if (effect.type === 'region_set') {
              console.log(`  地区变更：${bundle.regions.find(item => item.id === effect.id)?.name}`);
            }
          }
        } else if (entry.type === 'death') {
          console.log(styleText('red', `【走向终局】${entry.message}`));
        } else if (entry.type === 'achievement') {
          console.log(styleText('yellow', `达成成就：${bundle.achievements.find(item => item.id === entry.data.achievement_id)?.name} — ${entry.message}`));
        } else {
          console.log(`  ${entry.message}`);
        }
      }
      const p = state.player;
      const fictional = p.calendar_year - bundle.era.historical_end_year;
      const statusStr = state.timeline === 'historical' ? '历史推进' : fictional > 0 ? `架空延续第 ${fictional} 年` : '架空推演';
      console.log(styleText('gray', `[${p.calendar_year}年·${p.age}岁 | ${bundle.era.identities.find(item => item.id === p.identity_id)?.name} | 属性: 体${p.attributes.physique} 智${p.attributes.intelligence} 富${p.attributes.wealth} 声${p.attributes.prestige} 运${p.attributes.luck} | 状态: ${statusStr}]`));
      p.chains.filter(chain => chain.status === 'active').forEach((chain, index) => {
        console.log(`【进行中的事业 ${index + 1}】${bundle.chains.find(item => item.id === chain.chain_id)?.name ?? chain.chain_id} (${chain.instance_id})；pause 暂停后输入 abandon ${index + 1} 可退出，已付成本不退。`);
      });
      if (pending) {
        if (!pendingEventShown) console.log(`${pending.kind === 'option' ? '【事件抉择】' : '【自动演绎】'}${narrative(bundle.events.find(event => event.id === pending.event_id)!.text)}`);
        if (pending.kind === 'option') {
          console.log(header('【你的决策】'));
          pending.options.forEach((option, idx) => {
            const num = styleText('bold', styleText('yellow', `[${idx + 1}]`));
            const hint = option.available ? styleText('green', '可选') : styleText('red', `不可选(${option.reason})`);
            const checks = option.checks.length === 0 ? '无检定' : `可能检定：${option.checks.map(check => `${attributeNames[check.attribute]} / DC ${check.dc}`).join('、')}（按分支触发）`;
            console.log(`  👉 输入 ${num} 或 choose ${option.id}  ——  ${option.text} [${hint}] [${riskNames[option.risk]}] ${checks}`);
            const event = bundle.events.find(item => item.id === pending.event_id);
            const source = event?.interaction === 'choice' ? event.options.find(item => item.id === option.id) : undefined;
            for (const effect of source?.outcome.effects ?? []) {
              if (effect.type !== 'chain_start') continue;
              const commitment = bundle.chains.find(chain => chain.id === effect.id)?.commitment;
              if (commitment) console.log(`     【起步前说明】${commitment}`);
            }
          });
        } else {
          console.log(`${narrative(pending.text)}\n阶段 ${pending.stage_id}：${attributeNames[pending.check.attribute]} / DC ${pending.check.dc}；自动掷骰并结算，无需选择。`);
        }
      }
      if (state.status === 'ENDED') {
        const report = engine.generateEndingReport();
        console.log(styleText('red', '\n════════════════════ 人生结束 ════════════════════'));
        console.log(`【主线结局】${report.primary_achievement_id === null ? '普通人生' : bundle.achievements.find(item => item.id === report.primary_achievement_id)?.name}；${bundle.deaths.find(item => item.id === report.death_id)?.name}`);
        console.log(`【享年寿命】终止年龄：${report.end_age} 岁（历经 ${report.years_played} 载风雨）`);
        console.log(`【最终身份】${bundle.era.identities.find(item => item.id === state.player.identity_id)?.name}`);
        const achievementNames = (ids: string[]) => ids.length === 0 ? '无' : ids.map(id => bundle.achievements.find(item => item.id === id)?.name ?? id).join('、');
        console.log(`【时代里程碑】${achievementNames(report.milestone_achievement_ids)}`);
        console.log(`【市井轶事】${achievementNames(report.anecdote_achievement_ids)}`);
        const legacy = report.achievements.filter(id => bundle.achievements.find(item => item.id === id)?.category === undefined);
        if (legacy.length) console.log(`【其他成就】${achievementNames(legacy)}`);
        console.log(styleText('yellow', `本局已结束，存档保留。另开一局：${newCommand}\n`));
      }
    };
    console.log(`种子：${session.exportSave().engine.payload.run.seed}\n内容指纹：${fingerprint}\n存档：${resolve(directory)}`);
    console.log(`继续本局：npm run play -- --content ${quote(contentArgument)} --state ${quote(resolve(directory))}`);
    if (stored) {
      const opening = stored.engine.payload.logs.find(entry => entry.type === 'opening');
      if (opening?.type === 'opening') showCard(opening.data.card_id, true);
    }
    let paused = false;
    let advancing = false;
    let closing = false;
    let inputClosed = false;
    const inputs: string[] = [];
    let wake: (() => void) | undefined;
    let interruptBeat: (() => void) | undefined;
    const stop = () => { paused = true; interruptBeat?.(); };
    lines = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
    lines.on('line', input => {
      const text = input.trim();
      if (text === 'pause') { stop(); console.log('已请求暂停；当前命令保存后停止。'); return; }
      if (advancing && inputs.length === 0 && text === 'quit') { closing = true; stop(); }
      else if (text) inputs.push(text);
      wake?.();
    });
    lines.on('close', () => { inputClosed = true; wake?.(); interruptBeat?.(); });
    lines.on('SIGINT', () => { closing = true; stop(); wake?.(); });
    const shouldStop = () => paused || closing || interrupted();
    let beatYear = session.current().state.player.calendar_year - 1;
    const displayResult = async (result: CommandResult) => {
      show();
      if (!result.ok) process.stderr.write(`错误 [${result.error.code}] ${result.error.message}\n`);
      const year = result.state.player.calendar_year;
      if (process.stdin.isTTY && year !== beatYear && !shouldStop()) {
        beatYear = year;
        await new Promise<void>(resolveBeat => {
          const timer = setTimeout(finish, 800);
          function finish() { clearTimeout(timer); interruptBeat = undefined; resolveBeat(); }
          interruptBeat = finish;
        });
      }
    };
    const advance = async () => {
      advancing = true;
      try {
        if (args.auto) {
          while (!shouldStop() && session.current().state.status !== 'ENDED') {
            const pending = session.current().pending;
            const result = await session.command(pending?.kind === 'option'
              ? { type: 'choose', optionId: chooseAutomaticOption(pending) }
              : pending?.kind === 'stage' ? { type: 'stage' } : { type: 'next' });
            await displayResult(result);
            if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
            await nextTurn();
          }
        } else {
          const result = await session.advanceToDecision(`life-auto:${session.exportSave().engine.revision}:${session.exportSave().cursor.input_sequence}`, { shouldStop, onResult: displayResult });
          if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        }
      } finally { advancing = false; }
    };
    console.log(args.auto
      ? '全自动模式：随机选择可用选项并推进至结局；pause 可暂停，Ctrl+C 在当前命令保存后停止。'
      : '日常境遇由骰子自动演绎，重大人生走向等你决定。命令：序号 / choose <id> / pause / continue / next（单步后暂停） / abandon <事业编号或实例> / status / quit');
    show();
    try {
      await advance();
      while (!closing && !interrupted()) {
        if (inputs.length === 0) {
          if (inputClosed || (args.auto && session.current().state.status === 'ENDED')) break;
          await new Promise<void>(resolveInput => { wake = resolveInput; });
          wake = undefined;
          continue;
        }
        const text = inputs.shift()!;
        if (text === 'quit') break;
        if (text === 'status') { show(); continue; }
        if (text === 'save') {
          await save(directory, session.exportSave());
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
        if (text === 'continue') { paused = false; await advance(); continue; }
        let result: CommandResult;
        const pending = session.current().pending;
        let chose = false;
        if (/^\d+$/.test(text) && pending?.kind === 'option') {
          const option = pending.options[Number(text) - 1];
          if (!option) { console.log(`无效序号。请输入 1 到 ${pending.options.length} 之间的数字。`); continue; }
          result = await session.command({ type: 'choose', optionId: option.id });
          chose = true;
        } else if (text.startsWith('choose ') && text.slice(7).length > 0) {
          result = await session.command({ type: 'choose', optionId: text.slice(7) });
          chose = true;
        } else if (text.startsWith('abandon ')) {
          const target = text.slice(8);
          const active = session.current().state.player.chains.filter(chain => chain.status === 'active');
          const chainInstanceId = /^\d+$/.test(target) ? active[Number(target) - 1]?.instance_id : target;
          if (!chainInstanceId) { console.log('未找到该事业编号；输入 status 查看进行中的事业。'); continue; }
          paused = true;
          result = await session.command({ type: 'abandon', chainInstanceId });
        } else if (text === 'next') {
          paused = true;
          result = await session.command({ type: text });
        } else { console.log('未知命令。输入序号 / continue / pause / next / abandon <编号或实例> / status / quit。'); continue; }
        await displayResult(result);
        if (chose && result.ok && !paused) await advance();
      }
    } finally { lines.close(); }
    if (exportFile !== undefined && !interrupted()) {
      await writeReplay(exportFile, buildReplay(engine, session.exportSave().replay_commands));
      console.log(`已导出回放：${resolve(exportFile)}`);
    }
  }, () => lines?.close());
});
