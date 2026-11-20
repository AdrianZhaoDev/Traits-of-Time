import type { Card, Event, Achievement } from './game/core/types/content.generated';
import { EnumMapper } from './game/presentation/EnumMapper';
import type { FoldItemData } from './game/presentation/LogParser';
import { STORAGE_NOTICE, type GameController, type AppSnapshot } from './controller';
import type { GamePlatform } from './platform';
import { GameAudio, type AudioChannel } from './audio';
import { cardPresentation, checkDetails, formatWealth, matchesTimeline, optionDetails, stageMayKill, yearHeading } from './presenters';
import { Ui, ink, fonts, type UiScene } from './ui';
import { buildHome } from './home';
import { ACHIEVEMENT_CATALOG, DEATH_CATALOG, type CatalogEntry, type CatalogKind } from './game/presentation/CollectionCatalog';
import { CollectionGoalStore } from './game/presentation/CollectionGoal';
import { buildEndingRecap } from './game/presentation/EndingRecap';
import { formatCollectionProgress } from './game/presentation/CollectionProgress';

const attributes = ['physique', 'wealth', 'intelligence', 'prestige', 'luck'] as const;
const itemArt: Record<string, string> = {
  CARD_MODERN_CORN: 'corn', CARD_MODERN_ANTIBIOTIC: 'antibiotic',
  CARD_MODERN_FLASHLIGHT: 'flashlight', CARD_MODERN_CALCULATOR: 'calculator',
  CARD_MODERN_GLUE: 'glue', CARD_MODERN_LIGHTER: 'lighter',
  CARD_NATIVE_BOWL: 'bowl', CARD_NATIVE_BOOK: 'book',
};
type HubTab = 'careers' | 'relics' | 'achievements';

export class GameViewBuilder {
  private readonly cards: Map<string, Card>;
  private readonly events: Map<string, Event>;
  private readonly achievements: Map<string, Achievement>;
  private hubTab: HubTab = 'careers';
  private codexTab: 'achievements' | 'deaths' = 'achievements';
  private codexScope: 'current' | 'history' = 'current';
  private codexStatus: 'all' | 'collected' | 'uncollected' = 'all';
  private codexCard = 'all';
  private choosingCodexCard = false;
  private readonly collectionGoal: CollectionGoalStore;
  private selectedCareer: string | null = null;
  private readonly expandedChecks = new Set<string>();
  private readonly expandedDice = new Set<string>();
  private readonly expandedYears = new Set<number>();
  private readonly seenYearCounts = new Map<number, number>();

  constructor(private readonly controller: GameController, private readonly audio: GameAudio,
    private readonly platform: GamePlatform, private readonly invalidate: () => void,
    private readonly latest: () => void) {
    this.collectionGoal = new CollectionGoalStore(platform.storage);
    this.cards = new Map(controller.bundle.cards.map(card => [card.id, card]));
    this.events = new Map(controller.bundle.events.map(event => [event.id, event]));
    this.achievements = new Map(controller.bundle.achievements.map(achievement => [achievement.id, achievement]));
  }

  base(snapshot: AppSnapshot, height: number, safeTop: number, safeBottom: number): UiScene {
    const ui = new Ui(this.platform.getViewport().width);
    const available = Math.max(0, height - safeTop - safeBottom);
    if (snapshot.screen !== 'game') {
      this.expandedChecks.clear();
      this.expandedDice.clear();
      this.expandedYears.clear();
      this.seenYearCounts.clear();
    }
    const content = snapshot.screen === 'home' ? buildHome(ui, snapshot, available, this.controller)
      : snapshot.screen === 'identity' ? this.identity(ui, snapshot, available)
        : this.game(ui, snapshot, available);
    return ui.finish(ui.view(content, {
      width: 750, height: available, position: 'absolute', left: 0, top: safeTop,
      backgroundColor: ink.paper,
    }), height);
  }

  overlay(snapshot: AppSnapshot, height: number, safeTop: number, safeBottom: number): UiScene {
    const ui = new Ui(this.platform.getViewport().width);
    const name = snapshot.overlay;
    if (!name) return ui.finish('', height, true);
    if (name === 'relic') return this.relic(ui, snapshot, height, safeTop, safeBottom);
    const inner = this.modalContentWidth(ui);
    const headings = {
      cards: '挑选开局家当', cardPool: '替换候选家当', decision: '重大抉择', stage: '当前检定', career: '人生管理',
      ending: '人生报告', stats: '人生统计', achievements: '人生图鉴', sound: '声音设置',
      restart: '确认重新开始', saveFailure: '存储尚未确认',
      inheritance: '选择下局传承', forfeitInheritance: '确认放弃传承',
    };
    const close = name !== 'cards' && name !== 'decision' && name !== 'stage' && name !== 'saveFailure';
    const header = this.modalHeader(ui, headings[name], inner, close, snapshot.busy);
    const notice = this.notice(ui, snapshot, inner);
    const gap = ui.px(8);
    const buttonHeight = ui.px(48);
    const primaryHeight = ui.px(56);
    let body = '';
    let footer = '';
    let footerHeight = buttonHeight;

    if (name === 'cards') {
      body = ui.text(`${snapshot.view?.pending?.kind === 'card' ? snapshot.view.pending.cards.length : 0} 件候选，只能带一件。确认前可免费替换任意候选，选定后本局不能更换。`, inner, {
        color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16),
      });
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'card') {
        for (const id of pending.cards) {
          const card = this.cards.get(id);
          if (card) body += this.cardOffer(ui, card, snapshot, inner)
            + ui.view(ui.button('replace_' + id, '替换「' + card.name + '」', inner,
              () => this.controller.openCardPool(id), { height: buttonHeight, disabled: snapshot.busy }),
            { marginBottom: ui.px(16) });
        }
      }
      footerHeight = primaryHeight;
      footer = ui.button('confirmCard', snapshot.busy ? '正在启程…'
        : snapshot.selectedCardId ? '确认家当，开始人生' : '请先选择一件家当', inner,
      () => this.controller.confirmCard(), {
        primary: true, height: primaryHeight, disabled: snapshot.busy || !snapshot.selectedCardId,
      });
    } else if (name === 'inheritance') {
      body = ui.text('选择一项属性，下一局开局时 +1，受属性上限限制；只生效一次，不累加。取消不会使用传承。', inner,
        { color: ink.muted, marginBottom: ui.px(16) });
      const legacy = snapshot.selectedInheritance?.kind === 'extra_card' ? snapshot.selectedInheritance : null;
      if (legacy) {
        body += ui.text(`你此前选了「${this.cards.get(legacy.card_id)?.name ?? '旧版指定家当'}」。原方案仍只占一个候选，家当可免费更换；也可以改选属性。`, inner,
          { color: ink.accent, marginBottom: ui.px(16) });
        if (snapshot.legacyInheritanceChoice === 'pending') body += ui.button('continueLegacyInheritance', '按原方案继续', inner,
          () => this.controller.continueLegacyInheritance(), { disabled: snapshot.busy, marginTop: gap });
        else body += ui.text('已选择按原方案继续。', inner, { fontWeight: '700' });
        body += ui.button('changeLegacyInheritance', '改选属性', inner,
          () => this.controller.changeLegacyInheritance(), { disabled: snapshot.busy, marginTop: gap }) + ui.gap(ui.px(16));
      }
      if (!legacy) for (const attribute of attributes) {
        const bonus = { kind: 'attribute' as const, attribute };
        const label = EnumMapper.translateStat(attribute).name + ' +1';
        const selected = snapshot.selectedInheritance?.kind === 'attribute' && snapshot.selectedInheritance.attribute === attribute;
        const padding = ui.px(12), border = ui.px(2), width = inner - 2 * (padding + border);
        body += ui.control('inheritance_' + attribute, label,
          ui.text(label + (selected ? ' · 已选' : ''), width, { fontWeight: '800' })
            + ui.text(`开局${EnumMapper.translateStat(attribute).name} +1，受属性上限限制。`, width, { marginTop: gap }),
          { width: inner, padding, minHeight: ui.px(44), marginBottom: ui.px(12), borderWidth: border,
            borderColor: ink.text, borderRadius: ui.px(8), backgroundColor: snapshot.busy ? ink.disabled : selected ? ink.sunSoft : ink.surface },
          () => this.controller.selectInheritance(bonus), { disabled: snapshot.busy, pressed: selected });
      }
      if (snapshot.records.warning) body += ui.text(snapshot.records.warning, inner, { color: ink.accent });
      footerHeight = primaryHeight;
      footer = ui.button('confirmInheritance', '确认传承，揭晓身份', inner, () => this.controller.confirmInheritance(),
        { primary: true, height: primaryHeight, disabled: snapshot.busy || !snapshot.selectedInheritance || snapshot.legacyInheritanceChoice === 'pending' });
    } else if (name === 'cardPool') {
      const pending = snapshot.view?.pending;
      const pool = this.controller.bundle.pools.find(item => item.id === this.controller.bundle.rules.opening.pool_id);
      const target = snapshot.replacementTarget ? this.cards.get(snapshot.replacementTarget) : null;
      body = ui.text(`替换「${target?.name ?? ''}」；已在候选中的家当不能重复选择。`, inner, {
        color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16),
      });
      for (const id of [...new Set((pool?.entries ?? []).filter(entry => entry.weight > 0).map(entry => entry.card_id))]) {
        const card = this.cards.get(id);
        if (!card || pending?.kind !== 'card') continue;
        const offered = pending.cards.includes(id);
        const padding = ui.px(12);
        const border = ui.px(2);
        const width = inner - 2 * (padding + border);
        const presentation = cardPresentation(card);
        body += ui.control('pool_' + id, card.name + (offered ? ' · 已在候选中' : ' · 替换候选'),
          ui.text(card.name + (offered ? ' · 已在候选中' : ''), width, { fontWeight: '800' })
            + ui.text(card.rarity, width, { color: ink.muted, marginTop: gap })
            + (presentation.direction ? ui.text(presentation.direction, width, { marginTop: gap }) : '')
            + ui.text(card.description, width, { marginTop: gap })
            + (presentation.effect ? ui.text(presentation.effect, width, { color: ink.muted, marginTop: gap }) : ''),
          { width: inner, minHeight: ui.px(44), padding, marginBottom: ui.px(12), borderWidth: border,
            borderColor: ink.text, borderRadius: ui.px(8), backgroundColor: offered || snapshot.busy ? ink.disabled : ink.surface },
          () => this.controller.replaceCardOffer(id), { disabled: offered || snapshot.busy });
      }
      footer = ui.button('closeCardPool', '返回候选', inner, () => this.controller.close(), { height: buttonHeight });
    } else if (name === 'decision') {
      const view = snapshot.view;
      const pending = view?.pending;
      if (view && pending?.kind === 'option') {
        const event = this.events.get(pending.event_id);
        if (event?.interaction === 'choice') {
          body = ui.text(event.title ?? '当下抉择', inner, {
            fontSize: ui.px(20), lineHeight: ui.px(30), fontWeight: '800', marginBottom: gap,
          }) + ui.text(event.text, inner, { marginBottom: ui.px(20) });
          for (const option of event.options) {
            const status = pending.options.find(entry => entry.id === option.id);
            if (!status || (!status.available && matchesTimeline(option.condition, view.timeline) === false)) continue;
            const padding = ui.px(12);
            const border = ui.px(1.5);
            const contentWidth = inner - 2 * (padding + border);
            const details = optionDetails(this.controller.bundle, event, option, status);
            let optionContent = ui.text(option.text, contentWidth, { fontWeight: '700' });
            if (details.length) optionContent += ui.text(details.join('\n'), contentWidth, {
              fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.muted, marginTop: gap,
            });
            if (!status.available) optionContent += ui.text(
              status.reason && status.reason !== 'OUTCOME_NOT_APPLICABLE' ? status.reason : '当前条件不足，无法采取这项行动。',
              contentWidth, { fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.accent, marginTop: gap });
            body += ui.control(`option_${option.id}`, option.text, optionContent, {
              width: inner, minHeight: ui.px(44), padding, marginBottom: gap,
              borderWidth: border, borderColor: ink.text, borderRadius: ui.px(8),
              backgroundColor: snapshot.busy || !status.available ? ink.disabled : ink.surface,
            }, () => this.controller.choose(option.id), { disabled: snapshot.busy || !status.available });
            if (status.checks.length) {
              const key = `${pending.event_instance_id}:option:${option.id}`;
              const expanded = this.expandedChecks.has(key);
              body += ui.button('check_' + option.id, `检定怎么算 · ${expanded ? '收起' : '展开'}`, inner,
                () => { if (expanded) this.expandedChecks.delete(key); else this.expandedChecks.add(key); this.invalidate(); },
                { pressed: expanded, height: buttonHeight });
              if (expanded) {
                const stage = event.stages?.find(item => item.id === option.outcome.next_stage_id);
                body += ui.text(status.checks.flatMap(check => checkDetails(check, !!stage?.critical_success)).join('\n'), inner,
                  { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: gap });
              }
              body += ui.gap(ui.px(12));
            }
          }
        }
      }
      footer = ui.button('decisionCareer', '管理事业', inner,
        () => this.controller.open('career'), { height: buttonHeight, disabled: snapshot.busy });
    } else if (name === 'stage') {
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'stage') {
        const check = pending.check;
        const event = this.events.get(pending.event_id);
        const stage = event?.stages?.find(item => item.id === pending.stage_id);
        body = ui.text(pending.text, inner, { marginBottom: ui.px(20) })
          + ui.text(EnumMapper.translateStat(check.attribute).name + '检定', inner, {
            fontSize: ui.px(18), lineHeight: ui.px(28), fontWeight: '700',
          }) + ui.text(Math.round(check.success_probability * 100) + '%', inner, {
            fontSize: ui.px(36), lineHeight: ui.px(48), fontWeight: '800', marginTop: gap,
          }) + ui.text('真实成功率，结果由本次检定决定。', inner, {
            color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16),
          });
        if (event && stage && stageMayKill(event, stage)) body += ui.text('风险：本次检定的后续结果可能导致死亡。', inner,
          { color: ink.accent, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16) });
        const key = `${pending.event_instance_id}:stage:${pending.stage_id}`;
        const expanded = this.expandedChecks.has(key);
        body += ui.button('stageCheckDetails', `检定怎么算 · ${expanded ? '收起' : '展开'}`, inner,
          () => { if (expanded) this.expandedChecks.delete(key); else this.expandedChecks.add(key); this.invalidate(); },
          { pressed: expanded, height: buttonHeight });
        if (expanded) body += ui.text(checkDetails(check, !!stage?.critical_success).join('\n'), inner,
          { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: gap });
      }
      footerHeight = primaryHeight;
      footer = ui.button('resolveStage', snapshot.busy ? '正在检定…' : '继续检定', inner,
        () => this.controller.resolveStage(), { primary: true, height: primaryHeight, disabled: snapshot.busy });
    } else if (name === 'career') {
      body = this.career(ui, snapshot, inner);
      body += ui.button('restartLife', snapshot.readOnlyReason ? '只读模式不可重新开始' : '重新开始', inner,
        () => this.controller.start(), { marginTop: ui.px(16), height: buttonHeight,
          disabled: snapshot.busy || snapshot.saveBlocked || !!snapshot.readOnlyReason });
      if (this.hubTab === 'careers') {
        const selected = snapshot.view?.player.chains.find(chain => chain.instance_id === this.selectedCareer && chain.status === 'active');
        const warning = '退出后已付费用不退，\n已学本事保留。';
        const warningHeight = this.textHeight(ui, warning, inner, 14, 22);
        footerHeight = warningHeight + gap + buttonHeight + gap + buttonHeight;
        footer = ui.text(warning, inner, { color: ink.accent, fontSize: ui.px(14), lineHeight: ui.px(22) })
          + ui.button('abandonCareer', selected ? '确认退出选中事业' : '先选择进行中的事业', inner,
            () => selected && this.controller.abandon(selected.instance_id), {
              height: buttonHeight, color: ink.accent, marginTop: gap, disabled: snapshot.busy || !selected,
            });
      }
      footer += ui.button('closeCareer', '返回上一页', inner, () => this.controller.close(), {
        height: buttonHeight, marginTop: this.hubTab === 'careers' ? gap : 0, disabled: snapshot.busy,
      });
    } else if (name === 'ending') {
      body = this.ending(ui, snapshot, inner);
      footerHeight = primaryHeight + gap + buttonHeight;
      const half = Math.floor((inner - gap) / 2);
      footer = ui.button('restartEnding', snapshot.readOnlyReason ? '只读模式不可重启' : snapshot.records.inheritanceAvailable ? '选择传承，再来一局' : '重启人生', inner, () => this.controller.start(), {
        primary: true, height: primaryHeight, disabled: snapshot.busy || !!snapshot.readOnlyReason,
      }) + ui.row(
        ui.button('reviewLife', '返回历程', half, () => this.controller.close(), { height: buttonHeight })
          + ui.view(ui.button('homeEnding', '返回首页', inner - half - gap,
            () => this.controller.home(), { height: buttonHeight }), { marginLeft: gap }),
        inner, { marginTop: gap });
    } else if (name === 'stats' || name === 'achievements') {
      const stats = snapshot.records;
      body = ui.text(`已完成 ${stats.completed} 段人生 · 当前收集 ${snapshot.collection.achievements.collected} 项成就 · ${snapshot.collection.deaths.collected} 种死因`, inner, {
        color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16),
      });
      if (name === 'stats') {
        for (const [label, value] of [
          ['完成的人生', stats.completed + ' 次'], ['最长寿命', stats.longest + ' 岁'],
          ['累计经历', stats.years + ' 年'], ['当前已获成就', snapshot.collection.achievements.collected + ' 项'],
          ['当前已收集死因', snapshot.collection.deaths.collected + ' 种'],
        ]) body += this.summaryRow(ui, label, value, inner);
      } else {
        body = this.codex(ui, snapshot, inner);
      }
      body += ui.text('仅统计本机完成的人生；当前未结束的进度不计入。', inner, {
        color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(20),
      });
      if (stats.warning) body += ui.text(stats.warning, inner, {
        color: ink.accent, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(12),
      });
      footer = ui.button('closeRecords', '返回', inner, () => this.controller.close(), { height: buttonHeight });
    } else if (name === 'sound') {
      body = this.sound(ui, inner);
      footer = ui.button('closeSound', '返回', inner, () => this.controller.close(), { height: buttonHeight });
    } else if (name === 'restart') {
      body = ui.text(snapshot.saveStatus === 'incompatible'
        ? '本机旧存档与当前版本不兼容。重新开始会逐步覆盖旧存档，无法再用它继续。'
        : snapshot.saveStatus === 'damaged' ? '本机存档无法读取。重新开始会逐步覆盖原存档。'
          : '重新开始会逐步覆盖本机当前人生，之后不能继续这局。', inner);
      footerHeight = primaryHeight + gap + buttonHeight;
      footer = ui.button('confirmRestart', '确认重新开始', inner, () => this.controller.confirmRestart(), {
        primary: true, height: primaryHeight, disabled: snapshot.busy,
      }) + ui.button('cancelRestart', '保留当前存档', inner, () => this.controller.close(), {
        height: buttonHeight, marginTop: gap, disabled: snapshot.busy,
      });
    } else if (name === 'saveFailure') {
      body = ui.text('人生存档或传承、记录尚未确认，自动推进已停止。请检查空间和权限，或恢复损坏的存档，再重新读取。若无法判断传承开局是否保存，传承会保持待确认，不能自动重开。恢复后会暂停。', inner);
      footer = ui.button('retryStorage', '重新读取本机存档', inner, () => this.controller.retryStorage(), {
        primary: true, height: buttonHeight, disabled: snapshot.busy,
      });
      if (snapshot.records.inheritancePending && !snapshot.readOnlyReason) {
        footerHeight = buttonHeight * 2 + gap;
        footer += ui.button('openForfeitInheritance', '无法恢复？放弃本次传承', inner,
          () => this.controller.openForfeitInheritance(), { height: buttonHeight, marginTop: gap, disabled: snapshot.busy });
      }
    } else if (name === 'forfeitInheritance') {
      body = ui.text('无法确定传承开局是否保存。确认放弃后，这次传承将被永久消耗，不会补发；本机人生存档不会因此删除。若能恢复原存档，请先返回并重新读取。以后重新开始仍会单独确认是否覆盖人生。', inner);
      footerHeight = primaryHeight + gap + buttonHeight;
      footer = ui.button('confirmForfeitInheritance', '确认放弃本次传承', inner, () => this.controller.confirmForfeitInheritance(), {
        primary: true, height: primaryHeight, disabled: snapshot.busy,
      }) + ui.button('cancelForfeitInheritance', '返回，不放弃', inner, () => this.controller.close(), {
        height: buttonHeight, marginTop: gap, disabled: snapshot.busy,
      });
    }

    return this.modal(ui, name === 'achievements' ? `achievements_${this.codexTab}` : name, header, notice + body, footer,
      footerHeight, height, safeTop, safeBottom);
  }


  private identity(ui: Ui, snapshot: AppSnapshot, height: number): string {
    const player = snapshot.view?.player;
    if (!player) return '';
    const gutter = ui.px(24);
    const width = 750 - gutter * 2;
    let body = this.notice(ui, snapshot, width)
      + ui.text('你将来到明朝', width, { fontFamily: fonts.title, fontSize: ui.px(26),
        lineHeight: ui.px(36), fontWeight: '800', color: ink.accent, marginBottom: ui.px(24) });
    for (const [label, value] of [
      ['年份', player.calendar_year + ' 年'], ['年龄', player.age + ' 岁'],
      ['身份', EnumMapper.translateIdentity(player.identity_id)],
      ['地区', EnumMapper.translateRegion(player.region_id)], ['阶层', EnumMapper.translateCaste(player.caste_id)],
    ]) body += this.summaryRow(ui, label, value, width);
    const bonus = snapshot.activeInheritance;
    if (bonus) body += ui.text(bonus.kind === 'attribute'
      ? `本局传承：开局${EnumMapper.translateStat(bonus.attribute).name} +1（受属性上限限制），当前初值 ${player.attributes[bonus.attribute]}。`
      : `本局传承：已将「${this.cards.get(bonus.card_id)?.name ?? '指定家当'}」放入候选，确认前仍可更换。`,
      width, { fontWeight: '700', marginTop: ui.px(16) });
    body += ui.text('年份、年龄和身份已经揭晓。接下来，从本局候选家当中选一件带入人生。', width,
      { color: ink.muted, marginTop: ui.px(24), marginBottom: ui.px(24) })
      + ui.button('revealCards', '挑选本局家当', width, () => this.controller.revealCards(),
        { primary: true, disabled: snapshot.busy });
    return ui.scroll(ui.view(body, { width, paddingTop: ui.px(32), paddingBottom: ui.px(24), minHeight: height }),
      width, height, 'identityScroll', { marginLeft: gutter });
  }

  private game(ui: Ui, snapshot: AppSnapshot, height: number): string {
    const view = snapshot.view;
    if (!view) return '';
    const player = view.player;
    const gutter = ui.px(16);
    const width = 750 - 2 * gutter;
    const gap = ui.px(8);
    const card = this.cards.get(player.cards[0]);
    const itemWidth = ui.px(44);
    const soundWidth = ui.px(56);
    const yearWidth = width - soundWidth - gap - (card ? itemWidth + gap : 0);
    const heading = yearHeading(view);
    const yearHeight = this.textHeight(ui, heading, yearWidth, 18, 27, '800');
    const topHeight = Math.max(ui.px(44), yearHeight);
    const identity = `${player.age} 岁`;
    const identityHeight = this.textHeight(ui, identity, width, 14, 22);
    const headerHeight = ui.px(8) + topHeight + gap + identityHeight + ui.px(8);
    const art = card && itemArt[card.id];
    const item = card ? ui.view(ui.control('heldItem', card.name + ' · ' + card.rarity + ' · 查看详情',
      art ? ui.image(this.platform.asset('art/items/' + art + '.png'), ui.px(32), ui.px(32))
        : ui.text('物', itemWidth - ui.px(4), { textAlign: 'center', fontWeight: '700' }),
      { width: itemWidth, height: ui.px(44), alignItems: 'center', justifyContent: 'center' },
      () => this.controller.inspectRelic(card.id)), { marginLeft: gap }) : '';
    const header = ui.view(
      ui.row(ui.text(heading, yearWidth, { fontFamily: fonts.title, fontSize: ui.px(18), lineHeight: ui.px(27),
        fontWeight: '800', color: ink.text }) + item
        + ui.view(ui.button('gameSound', '声音', soundWidth, () => this.controller.open('sound'),
          { height: ui.px(44), fontSize: ui.px(14) }), { marginLeft: gap }), width, { height: topHeight })
      + ui.text(identity, width, { fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: gap }),
      { width: 750, height: headerHeight, paddingLeft: gutter, paddingRight: gutter, paddingTop: ui.px(8),
        backgroundColor: ink.paper });
    const statWidth = Math.floor(width / attributes.length);
    let stats = '';
    let statHeight = ui.px(50);
    for (const key of attributes) {
      const value = key === 'wealth' ? formatWealth(player.attributes[key]) : String(player.attributes[key]);
      const valueHeight = this.textHeight(ui, value, statWidth - ui.px(4), 16, 24, '700');
      statHeight = Math.max(statHeight, ui.px(26) + valueHeight);
      stats += ui.view(ui.text(EnumMapper.translateStat(key).name, statWidth - ui.px(4), {
        textAlign: 'center', color: ink.muted, fontSize: ui.px(12), lineHeight: ui.px(20),
      }) + ui.text(value, statWidth - ui.px(4), {
        textAlign: 'center', fontSize: ui.px(16), lineHeight: ui.px(24), fontWeight: '700',
      }, `stat_${key}`), { width: statWidth, paddingTop: ui.px(4), alignItems: 'center' });
    }
    const statBar = ui.row(stats, 750, { height: statHeight + ui.px(8), paddingLeft: gutter,
      backgroundColor: ink.surface, alignItems: 'flex-start', borderBottomWidth: 1, borderColor: ink.line });
    const footerHeight = ui.px(136);
    const centerHeight = Math.max(ui.px(80), height - headerHeight - statHeight - ui.px(8) - footerHeight);
    const compact = height < headerHeight + statHeight + ui.px(8) + footerHeight + ui.px(80);
    const readingWidth = width;
    let logs = this.notice(ui, snapshot, readingWidth);
    let due: (typeof player.chains)[number] | undefined;
    let activeCareers = 0;
    for (const chain of player.chains) {
      if (chain.status !== 'active') continue;
      activeCareers++;
      if (chain.next_due_year === null) continue;
      if (!due || chain.next_due_year < due.next_due_year!
        || (chain.next_due_year === due.next_due_year && chain.instance_id < due.instance_id)) due = chain;
    }
    if (due) {
      const name = this.controller.bundle.chains.find(chain => chain.id === due.chain_id)?.name ?? '进行中的事业';
      const text = `${name} · ${due.next_due_year! <= player.calendar_year ? '等待本年进展' : `下次进展 ${due.next_due_year} 年`}`;
      logs += ui.control('nearestCareer', text + ' · 管理事业',
        ui.text(text + ' · 管理事业', readingWidth - ui.px(24), { fontSize: ui.px(14), lineHeight: ui.px(22), fontWeight: '700' }),
        { width: readingWidth, minHeight: ui.px(44), padding: ui.px(12), marginBottom: ui.px(16), backgroundColor: snapshot.busy ? ink.disabled : ink.sunSoft },
        () => { this.hubTab = 'careers'; this.selectedCareer = null; this.controller.open('career'); },
        { disabled: snapshot.busy });
    }
    logs += this.history(ui, snapshot.folds, player.calendar_year, readingWidth);
    if (!snapshot.folds.length) logs += ui.text('选择家当后，这段人生就此展开。', readingWidth, { color: ink.muted });
    const history = ui.view(logs, { width: 750, padding: gutter, paddingBottom: ui.px(24) });
    const stream = compact ? history : ui.scroll(history, 750, centerHeight, 'history');
    const blocked = snapshot.busy || view.status === 'AWAITING_CARD' || view.status === 'AWAITING_OPTION' || view.status === 'AWAITING_STAGE';
    const ended = view.status === 'ENDED';
    const smallWidth = Math.floor((width - gap) / 2);
    const footer = ui.view(
      ui.button('advance', ended ? '人生已结束 · 查看结局' : snapshot.busy ? '流年推演中…' : '推进一年 · 按住连续', width,
        () => ended ? this.controller.open('ending') : this.controller.advance(),
        { kind: 'seal', height: ui.px(56), disabled: blocked, fontSize: ui.px(16) })
      + ui.row(ui.button('gameCareer', `管理 (${activeCareers})`, smallWidth,
        () => { this.hubTab = 'careers'; this.selectedCareer = null; this.controller.open('career'); },
        { height: ui.px(48), fontSize: ui.px(14), disabled: snapshot.busy || view.status === 'AWAITING_CARD' })
        + ui.view(ui.button('latest', '查看最新', width - smallWidth - gap, this.latest,
          { height: ui.px(48), fontSize: ui.px(14) }), { marginLeft: gap }), width, { marginTop: gap }),
      { width: 750, height: footerHeight, padding: gutter, paddingTop: ui.px(8), backgroundColor: ink.paper,
        borderTopWidth: 1, borderColor: ink.line });
    if (compact && height >= footerHeight + ui.px(44)) {
      return ui.scroll(ui.view(header + statBar + history, { width: 750 }), 750, height - footerHeight, 'compactGame') + footer;
    }
    const content = header + statBar + stream + footer;
    return compact ? ui.scroll(ui.view(content, { width: 750 }), 750, height, 'compactGame') : content;
  }

  private history(ui: Ui, folds: readonly FoldItemData[], currentYear: number, width: number): string {
    const groups: { year: number | undefined; items: FoldItemData[] }[] = [];
    for (const item of folds) {
      const previous = groups[groups.length - 1];
      if (previous && previous.year === item.calendarYear) previous.items.push(item);
      else groups.push({ year: item.calendarYear, items: [item] });
    }
    let result = '';
    for (const [index, group] of groups.entries()) {
      const year = group.year;
      if (year === undefined || year === currentYear) {
        result += ui.text(year === undefined ? '年份未记录' : `${year} 年 · 本年`, width,
          { fontWeight: '800', marginBottom: ui.px(12) });
        for (const [itemIndex, item] of group.items.entries()) result += this.fold(ui, item, width, `${index}_${itemIndex}`);
        continue;
      }
      const expanded = this.expandedYears.has(year);
      const unread = group.items.length > (this.seenYearCounts.get(year) ?? 0);
      const label = `${year} 年 · ${group.items.length} 条${unread ? ' · 有新记录' : ''} · ${expanded ? '收起' : '展开'}`;
      result += ui.button(`historyYear_${year}_${index}`, label, width, () => {
        if (expanded) this.expandedYears.delete(year);
        else { this.expandedYears.add(year); this.seenYearCounts.set(year, group.items.length); }
        this.invalidate();
      }, { pressed: expanded, height: ui.px(48) }) + ui.gap(ui.px(8));
      if (expanded) for (const [itemIndex, item] of group.items.entries()) result += this.fold(ui, item, width, `${index}_${itemIndex}`);
    }
    return result;
  }

  private fold(ui: Ui, item: FoldItemData, width: number, slot: string): string {
    const event = item.eventId ? this.events.get(item.eventId) : undefined;
    const death = item.type === 'death';
    const label = death ? '人生终点' : item.type === 'opening' ? '初来人世'
      : item.type === 'history_switch' ? '历史改写' : item.type === 'card_selected' ? '随身家当'
        : item.type === 'achievement' ? '成就解锁' : event?.title || (item.type === 'chain' ? '事业进展' : '流年纪事');
    let content = ui.text((item.age === undefined ? '历程' : item.age + ' 岁') + ' · ' + label, width, {
      fontSize: ui.px(13), lineHeight: ui.px(21), color: death ? ink.accent : ink.muted,
      fontWeight: '700', marginBottom: ui.px(8),
    });
    if (item.segments) {
      for (const [segmentIndex, segment] of item.segments.entries()) {
        const earned = segment.kind === 'achievement' && segment.achievementId ? this.achievements.get(segment.achievementId) : undefined;
        if (segment.kind === 'achievement') {
          if (earned) content += ui.text('解锁成就：' + earned.name, width, {
            fontSize: ui.px(14), lineHeight: ui.px(22), fontWeight: '700', marginTop: ui.px(8),
          });
          else if (segment.achievementId && !segment.text) content += ui.text('未收录成就：' + segment.achievementId, width, { marginTop: ui.px(8) });
        }
        if (segment.stampTag && segment.stampTag !== earned?.name) content += ui.text('【' + segment.stampTag + '】', width, { fontWeight: '700', marginTop: ui.px(8) });
        const namePrefix = earned ? `【${earned.name}】` : '';
        const text = namePrefix && segment.text?.startsWith(namePrefix) ? segment.text.slice(namePrefix.length).trim() : segment.text;
        if (text && text !== earned?.name) content += ui.text((segment.kind === 'action' ? '你的行动：' : '') + text, width, {
          color: segment.kind === 'death' ? ink.accent : segment.kind === 'action' || segment.kind === 'dice' ? ink.muted : ink.text,
          marginTop: ui.px(8),
        });
        if (segment.kind === 'dice' && segment.details?.length) {
          const key = `${item.id ?? slot}:${segmentIndex}`;
          const expanded = this.expandedDice.has(key);
          content += ui.button(`diceDetails_${slot}_${segmentIndex}`, `检定详情 · ${expanded ? '收起' : '展开'}`, width,
            () => { if (expanded) this.expandedDice.delete(key); else this.expandedDice.add(key); this.invalidate(); },
            { pressed: expanded, marginTop: ui.px(8), height: ui.px(44) });
          if (expanded) content += ui.text(segment.details.join('\n'), width,
            { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(8) });
        }
        for (const change of segment.effectsText ?? []) content += ui.text(change, width, {
          fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.muted, marginTop: ui.px(4),
        });
      }
    } else {
      if (item.introText) content += ui.text(item.introText, width);
      if (item.actionText) content += ui.text('你的行动：' + item.actionText, width, { color: ink.muted, marginTop: ui.px(8) });
      if (item.outcomeText) content += ui.text(item.outcomeText, width, { color: death ? ink.accent : ink.text, marginTop: ui.px(8) });
      if (item.stampTag) content += ui.text('【' + item.stampTag + '】', width, { fontWeight: '700', marginTop: ui.px(8) });
      for (const change of item.effectsText ?? item.effectsSummary ?? []) content += ui.text(change, width, {
        fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.muted, marginTop: ui.px(4),
      });
      for (const id of item.achievementIds ?? []) {
        const earned = this.achievements.get(id);
        content += ui.text(earned ? '解锁成就：' + earned.name : '未收录成就：' + id, width, {
          fontSize: ui.px(14), lineHeight: ui.px(22), fontWeight: '700', marginTop: ui.px(8),
        });
      }
    }
    return ui.view(content, { width, paddingBottom: ui.px(20), marginBottom: ui.px(20),
      borderBottomWidth: 1, borderColor: ink.line });
  }

  private cardOffer(ui: Ui, card: Card, snapshot: AppSnapshot, width: number): string {
    const selected = card.id === snapshot.selectedCardId;
    const art = itemArt[card.id];
    const padding = ui.px(12);
    const border = ui.px(2);
    const inner = width - 2 * (padding + border);
    const artWidth = ui.px(40);
    const titleWidth = art ? inner - artWidth - ui.px(12) : inner;
    const presentation = cardPresentation(card);
    return ui.control('card_' + card.id, card.name + ' · ' + card.rarity,
      ui.row((art ? ui.image(this.platform.asset('art/items/' + art + '.png'), artWidth, artWidth,
        { marginRight: ui.px(12) }) : '')
        + ui.text(card.name, titleWidth, { fontWeight: '800', fontSize: ui.px(18), lineHeight: ui.px(28) }), inner)
      + ui.text(card.rarity + (selected ? ' · 已选' : ' · 点击选择'), inner, {
        color: ink.muted, fontSize: ui.px(13), lineHeight: ui.px(21), marginTop: ui.px(8),
      }) + (presentation.direction ? ui.text(presentation.direction, inner, { marginTop: ui.px(8) }) : '')
      + ui.text(card.description, inner, { marginTop: ui.px(8) })
      + (presentation.effect ? ui.text(presentation.effect, inner,
        { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(8) }) : ''),
      { width, padding, marginBottom: ui.px(12), backgroundColor: snapshot.busy ? ink.disabled : selected ? ink.sunSoft : ink.surface,
        borderColor: ink.text, borderWidth: border, borderRadius: ui.px(8) },
      () => this.controller.selectCard(card.id), { disabled: snapshot.busy, pressed: selected });
  }

  private career(ui: Ui, snapshot: AppSnapshot, width: number): string {
    const player = snapshot.view?.player;
    if (!player) return '';
    const gap = ui.px(8);
    const third = Math.floor((width - 2 * gap) / 3);
    const tabs: [HubTab, string][] = [['careers', '事业'], ['relics', '家当'], ['achievements', '生涯成就']];
    let body = ui.row(tabs.map(([id, label], index) => ui.view(
      ui.button('hub_' + id, (id === this.hubTab ? '✓ ' : '') + label,
        index === 2 ? width - 2 * third - 2 * gap : third,
        () => { this.hubTab = id; this.selectedCareer = null; this.invalidate(); },
        { fontSize: ui.px(14), pressed: id === this.hubTab }), { marginLeft: index ? gap : 0 })).join(''),
    width, { marginBottom: gap });
    body += ui.gap(ui.px(12));
    if (this.hubTab === 'careers') {
      for (const chain of player.chains) {
        const definition = this.controller.bundle.chains.find(item => item.id === chain.chain_id);
        if (!definition) continue;
        const active = chain.status === 'active';
        const selected = chain.instance_id === this.selectedCareer;
        const padding = ui.px(12);
        const border = ui.px(1.5);
        const inner = active ? width - 2 * (padding + border) : width;
        const content = ui.text(definition.name, inner, { fontWeight: '700' })
          + ui.text(active ? selected ? '进行中 · 已选' : '进行中 · 点击选择' : chain.status === 'completed' ? '已完成' : '已中断',
            inner, { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: gap })
          + ui.text(`进展 ${chain.node_index}/${definition.nodes.length}` + (active && chain.next_due_year !== null ? ` · 下次 ${chain.next_due_year} 年` : ''),
            inner, { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: gap })
          + (definition.commitment ? ui.text(definition.commitment, inner, { marginTop: gap }) : '');
        body += active ? ui.control('career_' + chain.instance_id, '选择：' + definition.name, content,
          { width, padding, marginBottom: ui.px(12), borderWidth: border, borderColor: ink.text,
            backgroundColor: selected ? ink.sunSoft : ink.surface },
          () => { this.selectedCareer = chain.instance_id; this.invalidate(); }, { disabled: snapshot.busy, pressed: selected })
          : ui.view(content, { width, paddingBottom: ui.px(16), marginBottom: ui.px(16), borderBottomWidth: 1, borderColor: ink.line });
      }
      if (!player.chains.length) body += this.entry(ui, '暂无事业记录', '选择一条事业路线后，会在这里看到进展。', width);
    } else if (this.hubTab === 'relics') {
      for (const id of player.cards) {
        const card = this.cards.get(id);
        if (!card) { body += this.entry(ui, '未识别的家当', `原始 ID：${id}`, width); continue; }
        const presentation = cardPresentation(card);
        body += this.entry(ui, card.name, [presentation.direction, card.description, presentation.effect].filter(Boolean).join('\n'), width, card.rarity);
      }
      if (!player.cards.length) body += this.entry(ui, '尚未获得家当', '本局实际持有的物品会记在这里。', width);
    } else {
      const ids = new Set([...snapshot.records.achievements, ...player.achievements, ...snapshot.ending?.achievements ?? []]);
      if (snapshot.ending?.primary_achievement_id) ids.add(snapshot.ending.primary_achievement_id);
      for (const id of ids) {
        const achievement = this.achievements.get(id);
        if (achievement) body += this.entry(ui, achievement.name, achievement.text, width,
          EnumMapper.achievementMeta(achievement) + (ACHIEVEMENT_CATALOG[id]?.status === 'current' ? '' : ' · 历史档案'));
        else body += this.entry(ui, '旧版条目，无法解析名称', `原始 ID：${id}`, width, '历史档案 · 已收集');
      }
      if (!ids.size) body += this.entry(ui, '尚无成就记录', '本机记录、本局与终局获得的成就会汇总在这里。', width);
    }
    return body;
  }

  private codex(ui: Ui, snapshot: AppSnapshot, width: number): string {
    const { collection, records } = snapshot;
    const gap = ui.px(8), half = Math.floor((width - gap) / 2);
    let body = ui.text(formatCollectionProgress('当前总收集', collection.total), width, { fontWeight: '800' })
      + ui.text(`${formatCollectionProgress('成就', collection.achievements)}\n${formatCollectionProgress('死因', collection.deaths)}`, width,
        { color: ink.muted, marginTop: gap })
      + (collection.total.total ? ui.view(ui.view('', { width: width * collection.total.percent / 100, height: ui.px(4), backgroundColor: ink.sun }),
        { width, height: ui.px(4), backgroundColor: ink.disabled, marginTop: gap, marginBottom: ui.px(16) }) : ui.gap(ui.px(16)))
      + ui.row((['achievements', 'deaths'] as const).map((tab, index) => ui.view(
        ui.button('codex_' + tab, tab === 'achievements' ? '成就' : '死因', index ? width - half - gap : half,
          () => { this.codexTab = tab; this.invalidate(); }, { pressed: this.codexTab === tab }),
        { marginLeft: index ? gap : 0 })).join(''), width, { marginBottom: gap })
      + ui.row((['current', 'history'] as const).map((scope, index) => ui.view(
        ui.button('codex_scope_' + scope, scope === 'current' ? '当前可收集' : '历史与待核实', index ? width - half - gap : half,
          () => { this.codexScope = scope; this.invalidate(); }, { pressed: this.codexScope === scope }),
        { marginLeft: index ? gap : 0 })).join(''), width, { marginBottom: ui.px(16) });

    const goal = this.collectionGoal.goal;
    if (goal) {
      const catalog = goal.kind === 'achievements' ? ACHIEVEMENT_CATALOG : DEATH_CATALOG;
      const item = this.controller.bundle[goal.kind].find(entry => entry.id === goal.id);
      const info = catalog[goal.id];
      const collected = records[goal.kind].has(goal.id);
      const state = collected ? '已达成' : item && info?.status === 'current' && info.hint ? '可以留意' : '当前版本暂不可追';
      body += ui.text(`收集目标：${item?.name ?? `旧版条目 ${goal.id}`} · ${state}`, width, { fontWeight: '700' });
      const cardNames = info?.cardIds.map(id => this.cards.get(id)?.name).filter((name): name is string => !!name) ?? [];
      if (cardNames.length) body += ui.text(`关联家当：${cardNames.join('、')}`, width, { color: ink.muted, marginTop: gap });
      if (!collected && state === '可以留意' && info?.hint) body += ui.text(info.hint, width, { color: ink.muted, marginTop: gap });
      body += ui.button('clearCollectionGoal', '清除目标', width, () => {
        this.collectionGoal.set(null, !snapshot.readOnlyReason);
        this.invalidate();
      }, { marginTop: gap, disabled: !!snapshot.readOnlyReason });
    } else body += ui.text('可以选一个收集目标；只是提醒，不改变事件和奖励。', width, { color: ink.muted });
    if (this.collectionGoal.warning) body += ui.text(this.collectionGoal.warning, width, { color: ink.accent, marginTop: gap });
    body += ui.gap(ui.px(16));

    const states = [['all', '全部状态'], ['collected', '已收集'], ['uncollected', '未收集']] as const;
    const third = Math.floor((width - 2 * gap) / 3);
    body += ui.row(states.map(([state, label], index) => ui.view(
      ui.button('codex_status_' + state, label, index === 2 ? width - 2 * (third + gap) : third,
        () => { this.codexStatus = state; this.invalidate(); }, { pressed: this.codexStatus === state }),
      { marginLeft: index ? gap : 0 })).join(''), width, { marginBottom: gap });
    const cardLabel = this.codexCard === 'all' ? '全部' : this.codexCard === 'none' ? '无特定家当／关联未明'
      : this.cards.get(this.codexCard)?.name ?? '关联未明';
    body += ui.button('codex_choose_card', `家当：${cardLabel}`, width, () => {
      this.choosingCodexCard = !this.choosingCodexCard;
      this.invalidate();
    }, { marginTop: gap });
    if (this.choosingCodexCard) {
      const choices = [['all', '全部家当'], ['none', '无特定家当／关联未明'],
        ...this.controller.bundle.cards.map(card => [card.id, card.name])] as const;
      for (const [id, label] of choices) body += ui.button('codex_card_' + id, label, width, () => {
        this.codexCard = id;
        this.choosingCodexCard = false;
        this.invalidate();
      }, { marginTop: gap, pressed: this.codexCard === id });
    }
    body += ui.text('当前目录只计已核实可获得的条目；历史记录和待核实条目不计入完成率。人生结算类成就只收录最终称号。', width,
      { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(16), marginBottom: ui.px(16) });
    if (records.unknownDeaths) body += ui.text(`有 ${records.unknownDeaths} 段旧人生未记录死因，旧成就已保留。`, width,
      { color: ink.muted, marginBottom: ui.px(16) });

    const catalog = this.codexTab === 'achievements' ? ACHIEVEMENT_CATALOG : DEATH_CATALOG;
    const items = this.codexTab === 'achievements'
      ? [...this.controller.bundle.achievements].sort((a, b) => Number(a.category === 'life') - Number(b.category === 'life'))
      : this.controller.bundle.deaths;
    const knownIds = new Set(items.map(item => item.id));
    const entries = [...items.map(item => ({ id: item.id, name: item.name, text: item.text })),
      ...[...records[this.codexTab]].filter(id => !knownIds.has(id)).map(id => ({ id, name: '旧版条目，名称暂不可用', text: '' }))];
    let shown = 0;
    for (const item of entries) {
      const info: CatalogEntry | undefined = catalog[item.id];
      const current = info?.status === 'current' && knownIds.has(item.id);
      const collected = records[this.codexTab].has(item.id);
      if ((this.codexScope === 'current') !== current) continue;
      if ((this.codexStatus === 'collected' && !collected) || (this.codexStatus === 'uncollected' && collected)) continue;
      if ((this.codexCard === 'none' && info?.cardIds.length) || (this.codexCard !== 'all' && this.codexCard !== 'none' && !info?.cardIds.includes(this.codexCard))) continue;
      shown++;
      const achievement = this.achievements.get(item.id);
      const status = current ? (collected ? '已收集' : '未收集')
        : `${collected ? '历史已收集' : info?.status === 'unavailable' ? '当前版本暂不可收集' : '可达性待核实'} · 不计入完成率`;
      const meta = [achievement ? EnumMapper.achievementMeta(achievement) : '', status].filter(Boolean).join(' · ');
      const text = collected ? item.text : current ? info?.hint ?? '' : '';
      body += this.entry(ui, item.name, text, width, meta);
      if (!knownIds.has(item.id)) body += ui.text(`原始 ID：${item.id}`, width, { color: ink.muted, marginBottom: gap });
      if (current && !collected && info?.hint) {
        const selected = goal?.kind === this.codexTab && goal.id === item.id;
        const kind: CatalogKind = this.codexTab;
        body += ui.button('codex_goal_' + item.id, selected ? `「${item.name}」已设为目标` : `设「${item.name}」为目标`, width, () => {
          this.collectionGoal.set({ kind, id: item.id }, !snapshot.readOnlyReason);
          this.invalidate();
        }, { disabled: selected || !!snapshot.readOnlyReason }) + ui.gap(ui.px(16));
      }
    }
    if (!shown) body += ui.text(this.codexScope === 'current' && !collection[this.codexTab].total
      ? '暂无可收集条目' : '没有符合筛选条件的条目。', width);
    return body;
  }

  private ending(ui: Ui, snapshot: AppSnapshot, width: number): string {
    const report = snapshot.ending;
    if (!report) return '';
    const recap = buildEndingRecap(this.controller.bundle, report, snapshot.view?.player ?? null, snapshot.logs);
    const primary = report.primary_achievement_id ? this.achievements.get(report.primary_achievement_id) : undefined;
    const achievementIds = new Set([...report.achievements, ...report.milestone_achievement_ids, ...report.anecdote_achievement_ids,
      ...(report.primary_achievement_id ? [report.primary_achievement_id] : [])]);
    const opening = snapshot.logs.find(log => log.type === 'opening' && log.calendar_year === report.start_year && log.age === report.start_age);
    const background = opening?.type === 'opening'
      ? this.controller.bundle.era.backgrounds.find(item => item.id === opening.data.background_id) : undefined;
    const openingIdentity = background && this.controller.bundle.era.identities.some(item => item.id === background.identity_id);
    let body = this.entry(ui, '初来乍到', recap.start + (openingIdentity ? '' : '\n开局身份没有可确认的记录。'), width)
      + this.entry(ui, '这一路', recap.experience, width)
      + this.entry(ui, '人生终点', recap.ending, width);
    const recordedDeath = snapshot.logs.some(log => log.type === 'death' && log.data.death_id === report.death_id && !!log.message.trim());
    if (!recordedDeath) {
      const death = this.controller.bundle.deaths.find(item => item.id === report.death_id);
      body += this.entry(ui, death ? '死因说明 · ' + death.name : '未识别的死因',
        death?.text ?? `原始 ID：${report.death_id}`, width);
    }
    const fresh = snapshot.newCollection;
    body += ui.text(`本局新收集：成就 ${fresh?.achievements.length ?? 0} 项 · 死因 ${fresh?.deaths.length ?? 0} 种`, width, { fontWeight: '800' });
    const names = [...(fresh?.achievements ?? []).map(id => this.achievements.get(id)?.name),
      ...(fresh?.deaths ?? []).map(id => this.controller.bundle.deaths.find(item => item.id === id)?.name)].filter(Boolean);
    body += ui.text(names.length ? names.join('、') : '本局没有新增图鉴条目。', width, { marginTop: ui.px(8) })
      + ui.text(formatCollectionProgress('当前总收集', snapshot.collection.total), width, { marginTop: ui.px(8) });
    if (snapshot.records.inheritanceAvailable) body += ui.text('已获得一次下局传承', width, { fontWeight: '700', marginTop: ui.px(8) });
    if (snapshot.records.warning) body += ui.text(snapshot.records.warning, width, { color: ink.accent, marginTop: ui.px(8) });
    const suggestion = this.controller.bundle.achievements.find(item =>
      item.category !== 'life' && !snapshot.records.achievements.has(item.id)
        && ACHIEVEMENT_CATALOG[item.id]?.status === 'current' && ACHIEVEMENT_CATALOG[item.id]?.hint);
    if (suggestion) body += ui.text(`下局可以留意「${suggestion.name}」：${ACHIEVEMENT_CATALOG[suggestion.id].hint}`, width,
      { color: ink.muted, marginTop: ui.px(16) });
    body += ui.button('endingCodex', '查看图鉴', width, () => this.controller.open('achievements'), { marginTop: ui.px(16) })
      + ui.gap(ui.px(20))
      + this.summaryRow(ui, '享寿', report.end_age + ' 岁', width)
      + this.summaryRow(ui, '积累家资', formatWealth(report.final_attributes.wealth), width)
      + this.summaryRow(ui, '达成成就', achievementIds.size + ' 项', width)
      + ui.gap(ui.px(20))
      + this.entry(ui, primary?.name ?? (report.primary_achievement_id ? '未识别的人生称号' : '暂无人生结算称号'),
        primary?.text ?? (report.primary_achievement_id ? `原始 ID：${report.primary_achievement_id}` : ''), width,
        primary ? EnumMapper.achievementMeta(primary) : '')
      + this.summaryRow(ui, '最高身份', EnumMapper.translateIdentity(report.highest_identity_id), width);
    for (const key of attributes) body += this.summaryRow(ui, EnumMapper.translateStat(key).name,
      key === 'wealth' ? formatWealth(report.final_attributes[key]) : String(report.final_attributes[key]), width);
    body += ui.text(`事业 · 完成 ${report.chains_completed.length} 项 / 中断 ${report.chains_interrupted.length} 项`, width,
      { fontWeight: '700', marginTop: ui.px(24), marginBottom: ui.px(8) });
    for (const [status, chains] of [['完成', report.chains_completed], ['中断', report.chains_interrupted]] as const) {
      for (const chain of chains) {
        const name = this.controller.bundle.chains.find(item => item.id === chain.chain_id)?.name;
        if (name) body += ui.text(status + ' · ' + name, width, { color: ink.muted, marginBottom: ui.px(8) });
      }
    }
    for (const id of achievementIds) {
      if (id === report.primary_achievement_id) continue;
      const earned = this.achievements.get(id);
      if (earned) body += this.entry(ui, earned.name, earned.text, width, EnumMapper.achievementMeta(earned));
      else body += this.entry(ui, '未识别的成就', `原始 ID：${id}`, width);
    }
    for (const id of snapshot.view?.player.cards ?? []) {
      const card = this.cards.get(id);
      if (card) body += this.entry(ui, '随身家当 · ' + card.name, card.description, width, card.rarity);
    }
    return body;
  }

  private sound(ui: Ui, width: number): string {
    const settings = this.audio.getSettings();
    let body = ui.text('分别调整音乐、音效和环境声。拖动音量条，或使用加减按钮。', width, { color: ink.muted, marginBottom: ui.px(24) });
    const channels: [AudioChannel, string][] = [['music', '音乐'], ['effects', '音效'], ['ambience', '环境声']];
    const gap = ui.px(8);
    const buttonWidth = Math.floor((width - 2 * gap) / 3);
    const inset = ui.px(12);
    const trackWidth = width - 2 * inset;
    const thumb = ui.px(20);
    for (const [channel, label] of channels) {
      const value = settings[channel];
      body += ui.row(ui.text(label, width / 2, { fontWeight: '700' })
        + ui.text(Math.round(value * 100) + '%', width / 2, { fontWeight: '700', textAlign: 'right' }), width);
      body += ui.control('volume_' + channel, label + '音量',
        ui.view('', { position: 'absolute', left: inset, top: ui.px(20), width: trackWidth, height: ui.px(8),
          backgroundColor: ink.disabled, borderWidth: ui.px(1), borderColor: ink.text, borderRadius: ui.px(4) })
        + ui.view('', { position: 'absolute', left: inset + ui.px(1), top: ui.px(21),
          width: Math.max(0, (trackWidth - ui.px(2)) * value), height: ui.px(6), backgroundColor: ink.sun, borderRadius: ui.px(3) })
        + ui.view('', { position: 'absolute', left: inset - thumb / 2 + trackWidth * value, top: ui.px(14), width: thumb, height: thumb,
          backgroundColor: ink.surface, borderWidth: ui.px(2), borderColor: ink.text, borderRadius: thumb / 2 }),
        { width, height: ui.px(48), marginBottom: gap, borderWidth: 0, backgroundColor: ink.clear, rangeInset: inset },
        () => undefined, { kind: 'range', value, setValue: next => { this.audio.setVolume(channel, next); this.invalidate(); } });
      body += ui.row(
        ui.button('minus_' + channel, '减小', buttonWidth, () => { this.audio.setVolume(channel, value - 0.05); this.invalidate(); }, { disabled: value <= 0 })
        + ui.view(ui.button('mute_' + channel, value > 0 ? '静音' : '恢复', buttonWidth,
          () => { this.audio.toggleMute(channel); this.invalidate(); }), { marginLeft: gap })
        + ui.view(ui.button('plus_' + channel, '增大', width - 2 * buttonWidth - 2 * gap,
          () => { this.audio.setVolume(channel, value + 0.05); this.invalidate(); }, { disabled: value >= 1 }), { marginLeft: gap }),
        width, { marginBottom: ui.px(24) });
    }
    body += ui.button('muteAll', channels.every(([channel]) => settings[channel] === 0) ? '恢复全部声音' : '全部静音', width,
      () => { this.audio.toggleMute(); this.invalidate(); })
      + ui.text('设置保存在本机。切到后台时，声音与连续推进会暂停。\n键盘可用 Tab 切换、方向键调音量、Esc 返回。', width,
        { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(20) });
    return body;
  }

  private relic(ui: Ui, snapshot: AppSnapshot, height: number, safeTop: number, safeBottom: number): UiScene {
    const card = snapshot.relicId ? this.cards.get(snapshot.relicId) : undefined;
    if (!card) return ui.finish('', height, true);
    const width = this.modalContentWidth(ui);
    const header = this.modalHeader(ui, '物品详情', width, false, false);
    const art = itemArt[card.id];
    const presentation = cardPresentation(card);
    const body = this.notice(ui, snapshot, width)
      + (art ? ui.image(this.platform.asset('art/items/' + art + '.png'), ui.px(72), ui.px(72), { marginBottom: ui.px(16) }) : '')
      + this.entry(ui, card.name, [presentation.direction, card.description, presentation.effect].filter(Boolean).join('\n'), width, card.rarity);
    return this.modal(ui, 'relic', header, body,
      ui.button('closeRelic', '收起详情', width, () => this.controller.close()), ui.px(48), height, safeTop, safeBottom, true);
  }

  private entry(ui: Ui, title: string, text: string, width: number, meta = ''): string {
    return ui.view(ui.text(title, width, { fontSize: ui.px(18), lineHeight: ui.px(28), fontWeight: '700' })
      + (meta ? ui.text(meta, width, { color: ink.muted, fontSize: ui.px(13), lineHeight: ui.px(21), marginTop: ui.px(4) }) : '')
      + (text ? ui.text(text, width, { marginTop: ui.px(8) }) : ''),
      { width, paddingBottom: ui.px(20), marginBottom: ui.px(20), borderBottomWidth: 1, borderColor: ink.line });
  }

  private summaryRow(ui: Ui, label: string, value: string, width: number): string {
    const labelWidth = Math.floor(width * 0.42);
    const valueWidth = width - labelWidth;
    return ui.row(ui.text(label, labelWidth, { color: ink.muted })
      + ui.text(value, valueWidth, { textAlign: 'right', fontWeight: '600' }), width,
    { paddingTop: ui.px(12), paddingBottom: ui.px(12), borderBottomWidth: 1, borderColor: ink.line });
  }

  private notice(ui: Ui, snapshot: AppSnapshot, width: number): string {
    return snapshot.notice && snapshot.notice !== STORAGE_NOTICE ? ui.text(snapshot.notice, width, {
      fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.accent, marginBottom: ui.px(16),
    }) : '';
  }


  private modalContentWidth(ui: Ui): number {
    return 750 - 2 * (ui.px(12) + ui.px(16) + ui.px(2));
  }

  private modalHeader(ui: Ui, title: string, width: number, close: boolean, busy: boolean): { xml: string; height: number } {
    const buttonWidth = ui.px(60);
    const gap = ui.px(8);
    const textWidth = close ? width - buttonWidth - gap : width;
    const height = Math.max(ui.px(48), this.textHeight(ui, title, textWidth, 24, 32, '800'));
    return { height, xml: ui.row(ui.text(title, textWidth, { fontFamily: fonts.title, fontSize: ui.px(24), lineHeight: ui.px(32),
      fontWeight: '800', color: ink.accent })
      + (close ? ui.view(ui.button('closeOverlay', '返回', buttonWidth, () => this.controller.close(),
        { height: ui.px(44), fontSize: ui.px(14), disabled: busy }), { marginLeft: gap }) : ''), width, { height }) };
  }

  private modal(ui: Ui, name: string, header: { xml: string; height: number }, body: string, footer: string,
    footerHeight: number, height: number, safeTop: number, safeBottom: number, dismiss = false): UiScene {
    const margin = ui.px(12);
    const padding = ui.px(16);
    const border = ui.px(2);
    const gap = ui.px(16);
    const width = this.modalContentWidth(ui);
    const panelHeight = Math.min(ui.px(760), height - safeTop - safeBottom - 2 * margin);
    const bodyHeight = panelHeight - 2 * (padding + border) - header.height - 2 * gap - footerHeight;
    const content = bodyHeight >= ui.px(80)
      ? header.xml + ui.gap(gap) + ui.scroll(body + ui.gap(ui.px(8)), width, bodyHeight, 'panel_' + name)
        + ui.view(footer, { width, height: footerHeight, marginTop: gap })
      : ui.scroll(header.xml + ui.gap(gap) + body + ui.gap(gap) + footer + ui.gap(gap), width,
        Math.max(ui.px(44), panelHeight - 2 * (padding + border)), 'panel_' + name);
    const backdrop = dismiss ? ui.control('dismissRelic', '收起物品详情', '', {
      width: 750, height, borderWidth: 0, borderRadius: 0, backgroundColor: ink.veil,
    }, () => this.controller.close()) : ui.view('', { width: 750, height, backgroundColor: ink.veil });
    const top = safeTop + (height - safeTop - safeBottom - panelHeight) / 2;
    const shadow = ui.view('', { position: 'absolute', left: margin + ui.px(3), top: top + ui.px(4),
      width: 750 - 2 * margin, height: panelHeight, borderRadius: ui.px(12), backgroundColor: ink.text });
    const panel = ui.view(content, { position: 'absolute', left: margin, top, width: 750 - 2 * margin, height: panelHeight,
      padding, backgroundColor: ink.surface, borderWidth: border, borderColor: ink.text, borderRadius: ui.px(12) }, 'modal');
    return ui.finish(backdrop + shadow + panel, height, true);
  }

  private textHeight(ui: Ui, value: string, width: number, size: number, leading: number, weight = 'normal'): number {
    const context = this.platform.context;
    context.save();
    context.font = weight + ' ' + ui.px(size) + 'px ' + fonts.body;
    let lines = 0;
    for (const paragraph of value.split('\n')) {
      let current = '';
      lines++;
      for (const character of paragraph) {
        const next = current + character;
        if (current && context.measureText(next).width > width) { lines++; current = character; }
        else current = next;
      }
    }
    context.restore();
    return Math.max(1, lines) * ui.px(leading);
  }
}
