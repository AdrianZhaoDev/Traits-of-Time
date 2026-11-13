import type { Card, Event, Achievement } from './game/core/types/content.generated';
import { EnumMapper } from './game/presentation/EnumMapper';
import type { FoldItemData } from './game/presentation/LogParser';
import { MEMORY_NOTICE, type GameController, type AppSnapshot } from './controller';
import type { GamePlatform } from './platform';
import { GameAudio, type AudioChannel } from './audio';
import { formatWealth, optionDetails, yearHeading } from './presenters';
import { Ui, ink, fonts, type UiScene } from './ui';
import { buildHome } from './home';

const attributes = ['physique', 'wealth', 'intelligence', 'prestige', 'luck'] as const;
const itemArt: Record<string, string> = {
  CARD_MODERN_CORN: 'corn', CARD_MODERN_ANTIBIOTIC: 'antibiotic',
  CARD_MODERN_FLASHLIGHT: 'flashlight', CARD_MODERN_CALCULATOR: 'calculator',
  CARD_MODERN_GLUE: 'glue', CARD_MODERN_LIGHTER: 'lighter',
  CARD_NATIVE_BOWL: 'bowl', CARD_NATIVE_BOOK: 'book',
};
type HubTab = 'careers' | 'modern' | 'relics' | 'achievements';

export class GameViewBuilder {
  private readonly cards: Map<string, Card>;
  private readonly events: Map<string, Event>;
  private readonly achievements: Map<string, Achievement>;
  private hubTab: HubTab = 'careers';
  private selectedCareer: string | null = null;

  constructor(private readonly controller: GameController, private readonly audio: GameAudio,
    private readonly platform: GamePlatform, private readonly invalidate: () => void,
    private readonly latest: () => void) {
    this.cards = new Map(controller.bundle.cards.map(card => [card.id, card]));
    this.events = new Map(controller.bundle.events.map(event => [event.id, event]));
    this.achievements = new Map(controller.bundle.achievements.map(achievement => [achievement.id, achievement]));
  }

  base(snapshot: AppSnapshot, height: number, safeTop: number, safeBottom: number): UiScene {
    const ui = new Ui(this.platform.getViewport().width);
    const available = Math.max(0, height - safeTop - safeBottom);
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
      cards: '挑选开局家当', decision: '重大抉择', stage: '当前检定', career: '人生管理',
      ending: '人生报告', stats: '人生统计', achievements: '生涯成就', sound: '声音设置',
    };
    const close = name !== 'cards' && name !== 'decision' && name !== 'stage';
    const header = this.modalHeader(ui, headings[name], inner, close, snapshot.busy);
    const notice = this.notice(ui, snapshot, inner);
    const gap = ui.px(8);
    const buttonHeight = ui.px(48);
    const primaryHeight = ui.px(56);
    let body = '';
    let footer = '';
    let footerHeight = buttonHeight;

    if (name === 'cards') {
      body = ui.text('三选一，只能带一件。选定后，本局不能更换。', inner, {
        color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16),
      });
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'card') {
        for (const id of pending.cards) {
          const card = this.cards.get(id);
          if (card) body += this.cardOffer(ui, card, snapshot, inner);
        }
      }
      footerHeight = primaryHeight;
      footer = ui.button('confirmCard', snapshot.busy ? '正在启程…'
        : snapshot.selectedCardId ? '确认家当，开始人生' : '请先选择一件家当', inner,
      () => this.controller.confirmCard(), {
        primary: true, height: primaryHeight, disabled: snapshot.busy || !snapshot.selectedCardId,
      });
    } else if (name === 'decision') {
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'option') {
        const event = this.events.get(pending.event_id);
        if (event?.interaction === 'choice') {
          body = ui.text(event.title ?? '当下抉择', inner, {
            fontSize: ui.px(20), lineHeight: ui.px(30), fontWeight: '800', marginBottom: gap,
          }) + ui.text(event.text, inner, { marginBottom: ui.px(20) });
          for (const option of event.options) {
            const status = pending.options.find(entry => entry.id === option.id);
            if (!status) continue;
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
          }
        }
      }
      footer = ui.button('decisionCareer', '管理事业', inner,
        () => this.controller.open('career'), { height: buttonHeight, disabled: snapshot.busy });
    } else if (name === 'stage') {
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'stage') {
        const check = pending.check;
        body = ui.text(pending.text, inner, { marginBottom: ui.px(20) })
          + ui.text(EnumMapper.translateStat(check.attribute).name + '检定', inner, {
            fontSize: ui.px(18), lineHeight: ui.px(28), fontWeight: '700',
          }) + ui.text(Math.round(check.success_probability * 100) + '%', inner, {
            fontSize: ui.px(36), lineHeight: ui.px(48), fontWeight: '800', marginTop: gap,
          }) + ui.text('真实成功率，结果由本次检定决定。', inner, {
            color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16),
          }) + this.summaryRow(ui, '当前属性', String(check.attribute_value), inner)
          + this.summaryRow(ui, '检定修正', this.signed(check.modifier_after), inner)
          + this.summaryRow(ui, '难度', String(check.dc), inner)
          + ui.text(`原修正 ${this.signed(check.modifier_before)}；本次生效修正 ${this.signed(check.modifier_after)}。\n检定加成也受修正上限限制。`, inner, {
            color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(16),
          });
      }
      footerHeight = primaryHeight;
      footer = ui.button('resolveStage', snapshot.busy ? '正在检定…' : '继续检定', inner,
        () => this.controller.resolveStage(), { primary: true, height: primaryHeight, disabled: snapshot.busy });
    } else if (name === 'career') {
      body = this.career(ui, snapshot, inner);
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
      footer = ui.button('restartEnding', '重启人生', inner, () => this.controller.start(), {
        primary: true, height: primaryHeight, disabled: snapshot.busy,
      }) + ui.row(
        ui.button('reviewLife', '返回历程', half, () => this.controller.close(), { height: buttonHeight })
          + ui.view(ui.button('homeEnding', '返回首页', inner - half - gap,
            () => this.controller.home(), { height: buttonHeight }), { marginLeft: gap }),
        inner, { marginTop: gap });
    } else if (name === 'stats' || name === 'achievements') {
      const stats = snapshot.records;
      body = ui.text(`已完成 ${stats.completed} 段人生 · 获得 ${stats.achievements.size} 项成就`, inner, {
        color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(16),
      });
      if (name === 'stats') {
        for (const [label, value] of [
          ['完成的人生', stats.completed + ' 次'], ['最长寿命', stats.longest + ' 岁'],
          ['累计经历', stats.years + ' 年'], ['已获成就', stats.achievements.size + ' 项'],
        ]) body += this.summaryRow(ui, label, value, inner);
      } else {
        for (const id of stats.achievements) {
          const achievement = this.achievements.get(id);
          if (achievement) body += this.entry(ui, achievement.name, achievement.text, inner,
            EnumMapper.achievementMeta(achievement));
        }
        if (!stats.achievements.size) body += this.entry(ui, '还没有解锁成就', '完成一段人生后，成就会留在这里。', inner);
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
    }

    return this.modal(ui, name, header, notice + body, footer,
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
    const soundWidth = ui.px(56);
    const yearWidth = width - soundWidth - gap;
    const heading = yearHeading(view);
    const yearHeight = this.textHeight(ui, heading, yearWidth, 18, 27, '800');
    const topHeight = Math.max(ui.px(44), yearHeight);
    const identity = `${player.age} 岁 · 身份：${EnumMapper.translateIdentity(player.identity_id)} · 第${player.calendar_year - player.start_year + 1}年`;
    const location = `地区：${EnumMapper.translateRegion(player.region_id)} · 阶层：${EnumMapper.translateCaste(player.caste_id)}`;
    const identityHeight = this.textHeight(ui, identity, width, 14, 22);
    const locationHeight = this.textHeight(ui, location, width, 13, 21);
    const headerHeight = ui.px(8) + topHeight + gap + identityHeight + locationHeight + ui.px(8);
    const header = ui.view(
      ui.row(ui.text(heading, yearWidth, { fontFamily: fonts.title, fontSize: ui.px(18), lineHeight: ui.px(27),
        fontWeight: '800', color: ink.text })
        + ui.view(ui.button('gameSound', '声音', soundWidth, () => this.controller.open('sound'),
          { height: ui.px(44), fontSize: ui.px(14) }), { marginLeft: gap }), width, { height: topHeight })
      + ui.text(identity, width, { fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: gap })
      + ui.text(location, width, { fontSize: ui.px(13), lineHeight: ui.px(21), color: ink.muted }),
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
    const railWidth = ui.px(68);
    const streamWidth = 750 - railWidth;
    const readingWidth = streamWidth - gutter * 2;
    let logs = this.notice(ui, snapshot, readingWidth);
    for (const item of snapshot.folds) logs += this.fold(ui, item, readingWidth);
    if (!snapshot.folds.length) logs += ui.text('选择家当后，这段人生就此展开。', readingWidth, { color: ink.muted });
    const history = ui.view(logs, { width: streamWidth, padding: gutter, paddingBottom: ui.px(24) });
    const stream = compact ? history : ui.scroll(history, streamWidth, centerHeight, 'history');
    const slotWidth = railWidth - ui.px(16);
    const slotInner = slotWidth - ui.px(4);
    let shelf = ui.text('博古架', slotWidth, { fontSize: ui.px(12), lineHeight: ui.px(20), color: ink.muted,
      textAlign: 'center', marginBottom: ui.px(12) });
    for (let index = 0; index < 5; index++) {
      const card = this.cards.get(player.cards[index]);
      if (!card) {
        shelf += ui.view(ui.text('空置', slotWidth, { fontSize: ui.px(12), lineHeight: ui.px(20), color: ink.muted,
          textAlign: 'center' }), { width: slotWidth, height: ui.px(68), marginBottom: gap,
          justifyContent: 'center', borderBottomWidth: 1, borderColor: ink.line });
        continue;
      }
      const art = itemArt[card.id];
      shelf += ui.control(`relic_${index}`, card.name + ' · ' + card.rarity + ' · 查看详情',
        (art ? ui.image(this.platform.asset('art/items/' + art + '.png'), ui.px(32), ui.px(32),
          { marginLeft: (slotInner - ui.px(32)) / 2 })
          : ui.text(card.name, slotInner, { fontSize: ui.px(12), lineHeight: ui.px(18), textAlign: 'center' }))
        + ui.text(card.rarity, slotInner, { fontSize: ui.px(12), lineHeight: ui.px(20), textAlign: 'center', color: ink.muted }),
        { width: slotWidth, minHeight: ui.px(68), marginBottom: gap, paddingTop: ui.px(4), paddingBottom: ui.px(4),
          borderWidth: ui.px(1), borderColor: ink.text, borderRadius: ui.px(6), backgroundColor: ink.surface },
        () => this.controller.inspectRelic(card.id));
    }
    const shelfContent = ui.view(shelf, { width: railWidth, padding: ui.px(8),
      backgroundColor: ink.surface, borderLeftWidth: 1, borderColor: ink.line });
    const rail = compact ? shelfContent : ui.scroll(shelfContent, railWidth, centerHeight, 'shelf', { backgroundColor: ink.surface });
    const blocked = snapshot.busy || view.status === 'AWAITING_CARD' || view.status === 'AWAITING_OPTION' || view.status === 'AWAITING_STAGE';
    const ended = view.status === 'ENDED';
    const activeCareers = player.chains.filter(chain => chain.status === 'active').length;
    const smallWidth = Math.floor((width - 2 * gap) / 3);
    const footer = ui.view(
      ui.button('advance', ended ? '人生已结束 · 查看结局' : snapshot.busy ? '流年推演中…' : '推进流年 · 按住快进', width,
        () => ended ? this.controller.open('ending') : this.controller.advance(),
        { kind: 'seal', height: ui.px(56), disabled: blocked, fontSize: ui.px(16) })
      + ui.row(ui.button('gameCareer', `事业 (${activeCareers})`, smallWidth,
        () => { this.hubTab = 'careers'; this.selectedCareer = null; this.controller.open('career'); },
        { height: ui.px(48), fontSize: ui.px(14), disabled: snapshot.busy || view.status === 'AWAITING_CARD' })
        + ui.view(ui.button('restartLife', '重启人生', smallWidth, () => this.controller.start(),
          { height: ui.px(48), fontSize: ui.px(14), disabled: snapshot.busy }), { marginLeft: gap })
        + ui.view(ui.button('latest', '查看最新', width - 2 * smallWidth - 2 * gap, this.latest,
          { height: ui.px(48), fontSize: ui.px(14) }), { marginLeft: gap }), width, { marginTop: gap }),
      { width: 750, height: footerHeight, padding: gutter, paddingTop: ui.px(8), backgroundColor: ink.paper,
        borderTopWidth: 1, borderColor: ink.line });
    const content = header + statBar + ui.row(stream + rail, 750, compact
      ? { alignItems: 'flex-start' } : { height: centerHeight, alignItems: 'flex-start' }) + footer;
    return compact ? ui.scroll(ui.view(content, { width: 750 }), 750, height, 'compactGame') : content;
  }

  private fold(ui: Ui, item: FoldItemData, width: number): string {
    const event = item.eventId ? this.events.get(item.eventId) : undefined;
    const death = item.type === 'death';
    const label = death ? '人生终点' : item.type === 'opening' ? '初来人世'
      : item.type === 'history_switch' ? '历史改写' : item.type === 'card_selected' ? '随身家当'
        : item.type === 'achievement' ? '成就解锁' : event?.title || (item.type === 'chain' ? '事业进展' : '流年纪事');
    let content = ui.text((item.age === undefined ? '历程' : item.age + ' 岁') + ' · ' + label, width, {
      fontSize: ui.px(13), lineHeight: ui.px(21), color: death ? ink.accent : ink.muted,
      fontWeight: '700', marginBottom: ui.px(8),
    });
    if (item.introText) content += ui.text(item.introText, width);
    if (item.actionText) content += ui.text('你的行动：' + item.actionText, width, { color: ink.muted, marginTop: ui.px(8) });
    if (item.outcomeText) content += ui.text(item.outcomeText, width, { color: death ? ink.accent : ink.text, marginTop: ui.px(8) });
    if (item.stampTag) content += ui.text('【' + item.stampTag + '】', width, { fontWeight: '700', marginTop: ui.px(8) });
    for (const change of item.effectsText ?? item.effectsSummary ?? []) content += ui.text(change, width, {
      fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.muted, marginTop: ui.px(4),
    });
    for (const id of item.achievementIds ?? []) {
      const earned = this.achievements.get(id);
      if (earned) content += ui.text('解锁成就：' + earned.name, width, {
        fontSize: ui.px(14), lineHeight: ui.px(22), fontWeight: '700', marginTop: ui.px(8),
      });
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
    return ui.control('card_' + card.id, card.name + ' · ' + card.rarity,
      ui.row((art ? ui.image(this.platform.asset('art/items/' + art + '.png'), artWidth, artWidth,
        { marginRight: ui.px(12) }) : '')
        + ui.text(card.name, titleWidth, { fontWeight: '800', fontSize: ui.px(18), lineHeight: ui.px(28) }), inner)
      + ui.text(card.rarity + (selected ? ' · 已选' : ' · 点击选择'), inner, {
        color: ink.muted, fontSize: ui.px(13), lineHeight: ui.px(21), marginTop: ui.px(8),
      }) + ui.text(card.description, inner, { marginTop: ui.px(8) })
      + (card.check_bonus ? ui.text('检定修正 +' + card.check_bonus.amount + '（受修正上限限制）', inner,
        { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(8) }) : ''),
      { width, padding, marginBottom: ui.px(12), backgroundColor: snapshot.busy ? ink.disabled : selected ? ink.sunSoft : ink.surface,
        borderColor: ink.text, borderWidth: border, borderRadius: ui.px(8) },
      () => this.controller.selectCard(card.id), { disabled: snapshot.busy, pressed: selected });
  }

  private career(ui: Ui, snapshot: AppSnapshot, width: number): string {
    const player = snapshot.view?.player;
    if (!player) return '';
    const gap = ui.px(8);
    const half = Math.floor((width - gap) / 2);
    const tabs: [HubTab, string][] = [['careers', '事业'], ['modern', '现代词条'], ['relics', '家当'], ['achievements', '生涯成就']];
    let body = '';
    for (let index = 0; index < tabs.length; index += 2) {
      body += ui.row(tabs.slice(index, index + 2).map(([id, label], column) => ui.view(
        ui.button('hub_' + id, (id === this.hubTab ? '✓ ' : '') + label, column ? width - half - gap : half,
          () => { this.hubTab = id; this.selectedCareer = null; this.invalidate(); },
          { fontSize: ui.px(14), pressed: id === this.hubTab }), { marginLeft: column ? gap : 0 })).join(''),
      width, { marginBottom: gap });
    }
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
          + ui.text(`进展 ${chain.node_index}/${definition.nodes.length}` + (active && chain.next_due_year ? ` · 下次 ${chain.next_due_year} 年` : ''),
            inner, { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: gap })
          + (definition.commitment ? ui.text(definition.commitment, inner, { marginTop: gap }) : '');
        body += active ? ui.control('career_' + chain.instance_id, '选择：' + definition.name, content,
          { width, padding, marginBottom: ui.px(12), borderWidth: border, borderColor: ink.text,
            backgroundColor: selected ? ink.sunSoft : ink.surface },
          () => { this.selectedCareer = chain.instance_id; this.invalidate(); }, { disabled: snapshot.busy, pressed: selected })
          : ui.view(content, { width, paddingBottom: ui.px(16), marginBottom: ui.px(16), borderBottomWidth: 1, borderColor: ink.line });
      }
      if (!player.chains.length) body += this.entry(ui, '暂无事业记录', '选择一条事业路线后，会在这里看到进展。', width);
    } else if (this.hubTab === 'modern' || this.hubTab === 'relics') {
      const cards = player.cards.map(id => this.cards.get(id)).filter((card): card is Card => Boolean(card))
        .filter(card => this.hubTab === 'modern' ? card.id.startsWith('CARD_MODERN_') : !card.id.startsWith('CARD_MODERN_'));
      for (const card of cards) body += this.entry(ui, card.name, card.description, width, card.rarity);
      if (!cards.length) body += this.entry(ui, this.hubTab === 'modern' ? '尚无现代词条' : '尚未获得家当', '本局实际持有的物品会记在这里。', width);
    } else {
      const ids = new Set([...snapshot.records.achievements, ...player.achievements, ...snapshot.ending?.achievements ?? []]);
      if (snapshot.ending?.primary_achievement_id) ids.add(snapshot.ending.primary_achievement_id);
      for (const id of ids) {
        const achievement = this.achievements.get(id);
        if (achievement) body += this.entry(ui, achievement.name, achievement.text, width, EnumMapper.achievementMeta(achievement));
      }
      if (!ids.size) body += this.entry(ui, '尚无成就记录', '本机记录、本局与终局获得的成就会汇总在这里。', width);
    }
    return body;
  }

  private ending(ui: Ui, snapshot: AppSnapshot, width: number): string {
    const report = snapshot.ending;
    if (!report) return '';
    const death = this.controller.bundle.deaths.find(item => item.id === report.death_id);
    const primary = report.primary_achievement_id ? this.achievements.get(report.primary_achievement_id) : undefined;
    let body = ui.text(`${report.start_year}—${report.end_year} · ${report.start_age}—${report.end_age} 岁 · 历经 ${report.years_played} 年`,
      width, { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginBottom: ui.px(20) })
      + this.entry(ui, death?.name ?? '人生终点', death?.text ?? '这段人生走到了终点。', width)
      + this.summaryRow(ui, '享寿', report.end_age + ' 岁', width)
      + this.summaryRow(ui, '积累家资', formatWealth(report.final_attributes.wealth), width)
      + this.summaryRow(ui, '达成成就', report.achievements.length + ' 项', width)
      + ui.gap(ui.px(20))
      + this.entry(ui, primary?.name ?? '普通人生', primary?.text ?? '', width, primary ? EnumMapper.achievementMeta(primary) : '')
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
    for (const id of report.achievements) {
      if (id === report.primary_achievement_id) continue;
      const earned = this.achievements.get(id);
      if (earned) body += this.entry(ui, earned.name, earned.text, width, EnumMapper.achievementMeta(earned));
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
      + ui.text('设置保存在本机。切到后台时，声音与快进会暂停。\n键盘可用 Tab 切换、方向键调音量、Esc 返回。', width,
        { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22), marginTop: ui.px(20) });
    return body;
  }

  private relic(ui: Ui, snapshot: AppSnapshot, height: number, safeTop: number, safeBottom: number): UiScene {
    const card = snapshot.relicId ? this.cards.get(snapshot.relicId) : undefined;
    if (!card) return ui.finish('', height, true);
    const width = this.modalContentWidth(ui);
    const header = this.modalHeader(ui, '物品详情', width, false, false);
    const art = itemArt[card.id];
    const body = this.notice(ui, snapshot, width)
      + (art ? ui.image(this.platform.asset('art/items/' + art + '.png'), ui.px(72), ui.px(72), { marginBottom: ui.px(16) }) : '')
      + this.entry(ui, card.name, card.description, width, card.rarity)
      + ui.text(card.check_bonus ? '对应检定修正 +' + card.check_bonus.amount + '。\n这项加成也受检定修正上限限制。' : '本局随身家当', width,
        { color: ink.muted, fontSize: ui.px(14), lineHeight: ui.px(22) });
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
    return snapshot.notice && snapshot.notice !== MEMORY_NOTICE ? ui.text(snapshot.notice, width, {
      fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.accent, marginBottom: ui.px(16),
    }) : '';
  }

  private signed(value: number): string { return (value >= 0 ? '+' : '') + value; }

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
