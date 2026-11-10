import type { Card, Event, Achievement } from './game/core/types/content.generated';
import { EnumMapper } from './game/presentation/EnumMapper';
import type { FoldItemData } from './game/presentation/LogParser';
import type { GameController, AppSnapshot } from './controller';
import type { GamePlatform } from './platform';
import { GameAudio, type AudioChannel } from './audio';
import { formatWealth, optionDetails, yearHeading } from './presenters';
import { Ui, ink, fonts, type UiScene } from './ui';

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
    const ui = new Ui();
    const available = height - safeTop - safeBottom;
    const content = snapshot.screen === 'home' ? this.home(ui, snapshot, available)
      : snapshot.screen === 'identity' ? this.identity(ui, snapshot, available)
        : this.game(ui, snapshot, available);
    return ui.finish(ui.view(content, { width: 750, height: available, top: safeTop }), height);
  }

  overlay(snapshot: AppSnapshot, height: number, safeTop: number, safeBottom: number): UiScene {
    const ui = new Ui();
    const name = snapshot.overlay;
    if (!name) return ui.finish('', height, true);
    if (name === 'relic') return this.relic(ui, snapshot, height, safeTop);
    const panelHeight = Math.min(1120, height - safeTop - safeBottom - 48);
    const inner = 650;
    let heading = '';
    let body = '';
    let footer = '';
    let footerHeight = 110;
    let close = true;
    let accent: string = ink.borderLight;

    if (name === 'cards') {
      heading = '启封时空卷宗'; accent = ink.cyan; close = false;
      body = ui.text('挑选本世家当', inner, { fontFamily: fonts.title, fontSize: 36, color: ink.cyan })
        + ui.text('三选一，只能带一件。选定后，本局不能更换。', inner, { fontSize: 24, color: ink.sub, marginBottom: 20 });
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'card') {
        for (const id of pending.cards) {
          const card = this.cards.get(id);
          if (card) body += this.cardOffer(ui, card, snapshot);
        }
      }
      footer = ui.button('confirmCard', snapshot.busy ? '正在启程…' : '确认选定 · 开启人生', inner,
        () => this.controller.confirmCard(), { fill: ink.cyan, color: ink.background, border: ink.cyan,
          disabled: snapshot.busy || !snapshot.selectedCardId });
    } else if (name === 'decision') {
      heading = '重大抉择'; accent = ink.gold; close = false; footerHeight = 114;
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'option') {
        const event = this.events.get(pending.event_id);
        if (event?.interaction === 'choice') {
          body += ui.text(event.title ?? '当下抉择', inner, { fontSize: 34, color: ink.gold, marginBottom: 12 })
            + ui.text(event.text, inner, { marginBottom: 24 });
          for (const option of event.options) {
            const status = pending.options.find(entry => entry.id === option.id);
            if (!status) continue;
            const details = optionDetails(this.controller.bundle, event, option, status);
            let optionContent = ui.text(option.text, 606, { fontSize: 28, lineHeight: 42 });
            if (details.length) optionContent += ui.text(details.join('\n'), 606, {
              fontSize: 24, lineHeight: 36, color: ink.sub, marginTop: 8,
            });
            if (!status.available) optionContent += ui.text(
              status.reason && status.reason !== 'OUTCOME_NOT_APPLICABLE' ? status.reason : '当前条件不足，无法采取这项行动。',
              606, { fontSize: 24, lineHeight: 36, color: ink.red, marginTop: 8 });
            body += ui.control(`option_${option.id}`, option.text, optionContent, {
              width: inner, minHeight: 100, padding: 20, marginBottom: 16,
              borderColor: status.available ? ink.borderLight : ink.border,
            }, () => this.controller.choose(option.id), { disabled: snapshot.busy || !status.available });
          }
        }
      }
      footer = ui.button('decisionCareer', '管理事业', inner,
        () => this.controller.open('career'), { color: ink.gold, border: ink.gold, disabled: snapshot.busy });
    } else if (name === 'stage') {
      heading = '正在检定'; accent = ink.cyan; close = false;
      const pending = snapshot.view?.pending;
      if (pending?.kind === 'stage') {
        const check = pending.check;
        body = ui.text(pending.text, inner, { fontSize: 30, lineHeight: 48, marginBottom: 28 })
          + ui.text(EnumMapper.translateStat(check.attribute).name + '检定', inner, { color: ink.cyan, textAlign: 'center', fontSize: 34 })
          + ui.text(Math.round(check.success_probability * 100) + '%', inner, {
            fontSize: 88, lineHeight: 120, textAlign: 'center', color: ink.gold,
          }) + ui.text('成功率 · 结果由本次检定决定', inner, { textAlign: 'center', color: ink.sub })
          + ui.text(`当前属性 ${check.attribute_value} · 修正 ${check.modifier_after >= 0 ? '+' : ''}${check.modifier_after} · 难度 ${check.dc}`,
            inner, { fontSize: 24, lineHeight: 40, marginTop: 24, color: ink.sub, textAlign: 'center' });
      }
      footer = ui.button('resolveStage', snapshot.busy ? '正在检定…' : '继续检定', inner,
        () => this.controller.resolveStage(), { disabled: snapshot.busy, border: ink.cyan });
    } else if (name === 'career') {
      heading = '掌理当下事业'; accent = ink.gold; footerHeight = 202;
      body = this.career(ui, snapshot);
      const selected = snapshot.view?.player.chains.find(chain => chain.instance_id === this.selectedCareer && chain.status === 'active');
      const canAbandon = this.hubTab === 'careers' && Boolean(selected);
      footer = ui.button('abandonCareer', canAbandon ? '确认退出选中事业' : '先选择进行中的事业', inner,
        () => selected && this.controller.abandon(selected.instance_id), {
          fill: ink.ended, color: ink.red, border: ink.red, disabled: snapshot.busy || !canAbandon,
        }) + ui.button('closeCareer', '返回人生历程', inner, () => this.controller.close(), { marginTop: 16, disabled: snapshot.busy });
    } else if (name === 'ending') {
      heading = '终局盖棺 · 历史定论'; accent = ink.gold; footerHeight = 206;
      body = this.ending(ui, snapshot);
      footer = ui.button('restartEnding', '尘埃落定 · 重启人生', inner, () => this.controller.start(), {
        fill: ink.green, color: ink.background, border: ink.green, disabled: snapshot.busy,
      }) + ui.row(
        ui.button('reviewLife', '返回历程', 317, () => this.controller.close(), { height: 84 })
          + ui.view(ui.button('homeEnding', '返回首页', 317, () => this.controller.home(), { height: 84 }), { marginLeft: 16 }),
        inner, { marginTop: 16 });
    } else if (name === 'stats' || name === 'achievements') {
      const stats = snapshot.records;
      heading = name === 'stats' ? '人生统计' : '生涯成就';
      body = ui.text(`已完成 ${stats.completed} 段人生 · 获得 ${stats.achievements.size} 项成就`, inner, { color: ink.sub, marginBottom: 20 });
      if (name === 'stats') {
        for (const [label, value] of [
          ['完成的人生', stats.completed + ' 次'], ['最长寿命', stats.longest + ' 岁'],
          ['累计经历', stats.years + ' 年'], ['已获成就', stats.achievements.size + ' 项'],
        ]) body += ui.row(ui.text(label, 320, { color: ink.sub }) + ui.text(value, 300, { color: ink.gold, textAlign: 'right' }), inner,
          { padding: 14, borderBottomWidth: 1, borderColor: ink.border, minHeight: 90 });
      } else {
        for (const id of stats.achievements) {
          const achievement = this.achievements.get(id);
          if (achievement) body += this.entry(ui, achievement.name + ' · ' + EnumMapper.achievementMeta(achievement), achievement.text, ink.gold);
        }
        if (!stats.achievements.size) body += this.entry(ui, '还没有解锁成就', '完成一段人生后，成就会留在这里。');
      }
      body += ui.text('仅统计本机完成的人生；当前未结束的进度不计入。', inner, { color: ink.sub, fontSize: 24, marginTop: 24 });
      if (stats.warning) body += ui.text(stats.warning, inner, { color: ink.red, fontSize: 24, marginTop: 16 });
      footer = ui.button('closeRecords', '返回', inner, () => this.controller.close());
    } else if (name === 'sound') {
      heading = '声音设置'; accent = ink.cyan;
      body = this.sound(ui);
      footer = ui.button('closeSound', '返回', inner, () => this.controller.close());
    }

    const panel = ui.view(
      ui.row(ui.text(heading, close ? 524 : inner, { fontSize: 30, lineHeight: 44, color: accent, fontFamily: fonts.title })
        + (close ? ui.button('closeOverlay', '返回', 112, () => this.controller.close(), { height: 80, fontSize: 24, disabled: snapshot.busy }) : ''),
      inner, { height: 88, marginBottom: 8 })
      + ui.scroll(body + ui.gap(16), inner, Math.max(120, panelHeight - 148 - footerHeight), `panel_${name}`)
      + ui.view(footer, { width: inner, height: footerHeight, paddingTop: 20 }),
      { width: 702, height: panelHeight, padding: 24, position: 'absolute', left: 24,
        top: safeTop + (height - safeTop - safeBottom - panelHeight) / 2,
        backgroundColor: ink.panel, borderWidth: 2, borderColor: accent, borderRadius: 12 }, 'modal');
    return ui.finish(ui.view('', { width: 750, height, backgroundColor: ink.veil }) + panel, height, true);
  }

  private home(ui: Ui, snapshot: AppSnapshot, height: number): string {
    const background = ui.image(this.platform.asset('art/scenes/home.png'), 750, height,
      { position: 'absolute', left: 0, top: 0, opacity: 0.7 });
    const top = ui.row(ui.text('历史重开模拟器', 404, { color: ink.sub, fontSize: 24 })
      + ui.text('明末人生', 250, { textAlign: 'right', color: ink.cyan, fontSize: 22 }), 654, { height: 80 });
    const hero = ui.view(
      ui.text('时空词条', 654, { fontFamily: fonts.title, fontSize: 92, lineHeight: 130, textAlign: 'center' })
      + ui.text('带上一件现代物品，\n去明朝过一生。', 654, { fontSize: 32, lineHeight: 56, textAlign: 'center', marginTop: 20 })
      + ui.gap(100)
      + ui.button('startLife', snapshot.busy ? '正在揭晓身份…' : '我要穿越', 654, () => this.controller.start(), {
        height: 104, fill: ink.cyan, color: ink.background, border: ink.cyan, disabled: snapshot.busy, fontSize: 32,
      }) + ui.text('出发前，先看看你的身份。', 654, { fontSize: 24, color: ink.sub, textAlign: 'center', marginTop: 16 })
      + ui.row(
        ui.button('homeSound', '声音', 206, () => this.controller.open('sound'))
          + ui.view(ui.button('homeAchievements', '成就', 206, () => this.controller.open('achievements')), { marginLeft: 18 })
          + ui.view(ui.button('homeStats', '统计', 206, () => this.controller.open('stats')), { marginLeft: 18 }),
        654, { marginTop: 48 })
      + ui.text('本局进度仅临时保留，关闭或刷新后不能继续。', 654,
        { color: ink.sub, fontSize: 23, lineHeight: 38, textAlign: 'center', marginTop: 28 }),
      { width: 654, height: Math.max(920, height - 100), justifyContent: 'center' });
    return background + ui.view('', { position: 'absolute', width: 750, height, backgroundColor: ink.homeVeil })
      + ui.scroll(top + hero, 654, height, 'homeScroll', { marginLeft: 48 });
  }

  private identity(ui: Ui, snapshot: AppSnapshot, height: number): string {
    const player = snapshot.view?.player;
    if (!player) return '';
    const wells = [
      ['年份', player.calendar_year + ' 年'], ['年龄', player.age + ' 岁'],
      ['身份', EnumMapper.translateIdentity(player.identity_id)],
    ];
    let rows = '';
    for (const [index, [label, value]] of wells.entries()) rows += ui.view(
      ui.text(label, 184, { color: ink.sub, textAlign: 'center', fontSize: 24 })
        + ui.text(value, 184, { color: index === 2 ? ink.cyan : ink.text, fontSize: 32, lineHeight: 48, textAlign: 'center', marginTop: 16 }),
      { width: 206, minHeight: 190, padding: 10, marginLeft: index ? 18 : 0,
        backgroundColor: ink.inset, borderWidth: 1, borderColor: ink.border, borderRadius: 10 });
    const body = ui.text('确认身份', 654, { color: ink.sub, fontSize: 24 })
      + ui.text('你将来到明朝', 654, { fontFamily: fonts.title, fontSize: 48, lineHeight: 72, marginTop: 16 })
      + ui.text('明朝', 654, { fontFamily: fonts.title, fontSize: 60, lineHeight: 92, color: ink.cyan, textAlign: 'center', marginTop: 44 })
      + ui.row(rows, 654, { marginTop: 32, alignItems: 'stretch' })
      + ui.text(EnumMapper.translateRegion(player.region_id) + ' · ' + EnumMapper.translateCaste(player.caste_id), 654,
        { textAlign: 'center', fontSize: 30, color: ink.gold, marginTop: 36 })
      + ui.text('年份、年龄和身份已经揭晓。\n接下来，从本局候选家当中选一件带入人生。', 654,
        { color: ink.sub, fontSize: 26, lineHeight: 44, textAlign: 'center', marginTop: 24 })
      + ui.gap(60)
      + ui.button('revealCards', '挑选本局家当', 654, () => this.controller.revealCards(), {
        height: 96, fill: ink.cyan, color: ink.background, border: ink.cyan, disabled: snapshot.busy,
      });
    return ui.scroll(ui.view(body, { width: 654, paddingTop: 44, height: Math.max(1020, height - 44), justifyContent: 'center' }),
      654, height, 'identityScroll', { marginLeft: 48 });
  }

  private game(ui: Ui, snapshot: AppSnapshot, height: number): string {
    const view = snapshot.view;
    if (!view) return '';
    const player = view.player;
    const header = ui.view(
      ui.row(ui.text(yearHeading(view), 440, { fontFamily: fonts.title, fontSize: 27, color: ink.gold, lineHeight: 42 })
        + ui.text('#' + (player.calendar_year - player.start_year + 1), 142, { color: ink.sub, fontSize: 22, textAlign: 'right' })
        + ui.view(ui.button('gameSound', '声音', 100, () => this.controller.open('sound'), { height: 76, fontSize: 23 }), { marginLeft: 12 }),
        702, { height: 76 })
      + ui.row(
        ui.text('身份: ' + EnumMapper.translateIdentity(player.identity_id), 236, { fontSize: 21, lineHeight: 34 })
          + ui.text('地区: ' + EnumMapper.translateRegion(player.region_id), 268, { fontSize: 21, lineHeight: 34, color: ink.sub })
          + ui.text('阶层: ' + EnumMapper.translateCaste(player.caste_id), 170, { fontSize: 21, lineHeight: 34, color: ink.sub, textAlign: 'right' }),
        702, { padding: 8, minHeight: 54, backgroundColor: ink.inset, borderWidth: 1, borderColor: ink.border }),
      { width: 750, height: 160, paddingLeft: 24, paddingRight: 24, paddingBottom: 16, backgroundColor: ink.hud,
        borderBottomWidth: 1, borderColor: ink.border });
    let stats = '';
    for (const [index, key] of attributes.entries()) stats += ui.view(
      ui.text(EnumMapper.translateStat(key).name, 130, { textAlign: 'center', color: ink.muted, fontSize: 21, lineHeight: 30 })
        + ui.text(key === 'wealth' ? formatWealth(player.attributes[key]) : String(player.attributes[key]), 130, {
          textAlign: 'center', fontSize: 27, lineHeight: 40,
          color: key === 'wealth' ? ink.gold : key === 'physique' ? view.status === 'ENDED' ? ink.red : ink.green : ink.text,
        }, `stat_${key}`),
      { width: 138, minHeight: 78, paddingTop: 5, alignItems: 'center', marginLeft: index ? 6 : 0,
        backgroundColor: ink.slot, borderWidth: 1, borderColor: ink.border, borderRadius: 3 });
    const statBar = ui.row(stats, 750, { paddingLeft: 18, height: 104, backgroundColor: ink.inset, borderBottomWidth: 1, borderColor: ink.border });
    const centerHeight = height - 264 - 202;
    const logs = snapshot.folds.map(item => this.fold(ui, item)).join('');
    const stream = ui.scroll(ui.view(logs || ui.text('选择家当后，这段人生就此展开。', 566, { color: ink.sub }),
      { width: 634, padding: 20, paddingBottom: 32 }), 634, centerHeight, 'history');
    let shelf = ui.text('博古架', 112, { fontSize: 22, lineHeight: 34, textAlign: 'center', color: ink.sub })
      + ui.text('奇物槽', 112, { fontSize: 18, lineHeight: 26, textAlign: 'center', color: ink.muted, marginBottom: 24 });
    for (let index = 0; index < 5; index++) {
      const card = this.cards.get(player.cards[index]);
      if (!card) {
        shelf += ui.view(ui.text('空置', 84, { fontSize: 20, color: ink.muted, textAlign: 'center' }), {
          width: 88, height: 88, marginLeft: 12, marginBottom: 22, borderWidth: 1, borderColor: ink.border,
          borderRadius: 10, alignItems: 'center', justifyContent: 'center', opacity: 0.5, backgroundColor: ink.slot,
        });
        continue;
      }
      const art = itemArt[card.id];
      shelf += ui.control(`relic_${index}`, card.name + ' · 查看详情',
        ui.text('开局', 84, { color: card.id.startsWith('CARD_MODERN_') ? ink.cyan : ink.gold, fontSize: 17, lineHeight: 24, textAlign: 'center' })
          + (art ? ui.image(this.platform.asset('art/items/' + art + '.png'), 46, 46, { marginLeft: 19 })
            : ui.text(card.name.slice(0, 2), 84, { fontSize: 28, lineHeight: 46, textAlign: 'center' }))
          + ui.text(card.rarity, 84, { fontSize: 17, lineHeight: 22, textAlign: 'right', color: this.rarityColor(card.rarity) }),
        { width: 88, minHeight: 96, marginLeft: 12, marginBottom: 22, backgroundColor: ink.slot, borderColor: ink.cyan, borderRadius: 10 },
        () => this.controller.inspectRelic(card.id));
    }
    const rail = ui.view(shelf, { width: 116, height: centerHeight, paddingTop: 20,
      backgroundColor: ink.rail, borderLeftWidth: 1, borderColor: ink.border });
    const blocked = snapshot.busy || view.status === 'AWAITING_CARD' || view.status === 'AWAITING_OPTION' || view.status === 'AWAITING_STAGE';
    const ended = view.status === 'ENDED';
    const activeCareers = player.chains.filter(chain => chain.status === 'active').length;
    const footer = ui.view(
      ui.button('advance', ended ? '人生已结束 · 查看结局' : snapshot.busy ? '流年推演中…' : '印  推进流年 · 按住快进',
        702, () => ended ? this.controller.open('ending') : this.controller.advance(), {
          kind: 'seal', height: 86, fill: ended ? ink.ended : ink.advance,
          border: ended ? ink.red : ink.advanceBorder, disabled: blocked, fontSize: 28,
        })
      + ui.row(ui.button('gameCareer', `管理事业 (${activeCareers})`, 226,
        () => { this.hubTab = 'careers'; this.selectedCareer = null; this.controller.open('career'); },
        { height: 80, fontSize: 23, color: ink.gold, border: ink.gold, disabled: snapshot.busy || view.status === 'AWAITING_CARD' })
        + ui.view(ui.button('restartLife', '重启人生', 226, () => this.controller.start(), { height: 80, fontSize: 23, disabled: snapshot.busy }), { marginLeft: 12 })
        + ui.view(ui.button('latest', '滚至最新', 226, this.latest, { height: 80, fontSize: 23 }), { marginLeft: 12 }),
        702, { marginTop: 12 }),
      { width: 750, height: 202, padding: 24, paddingTop: 12, paddingBottom: 12, backgroundColor: ink.desk });
    return header + statBar + ui.row(stream + rail, 750, { height: centerHeight, alignItems: 'flex-start' }) + footer;
  }

  private fold(ui: Ui, item: FoldItemData): string {
    const event = item.eventId ? this.events.get(item.eventId) : undefined;
    const modern = item.cardId?.startsWith('CARD_MODERN_') === true;
    const death = item.type === 'death';
    const achievement = item.type === 'achievement';
    const color = death ? ink.red : modern ? ink.cyan : achievement ? ink.gold : ink.borderLight;
    const label = death ? '人生终点' : item.type === 'opening' ? '初来人世'
      : item.type === 'history_switch' ? '历史改写' : item.type === 'card_selected' ? '随身家当'
        : achievement ? '成就解锁' : event?.title || (item.type === 'chain' ? '事业进展' : '流年纪事');
    let content = ui.row(
      ui.text(item.age === undefined ? '历程' : item.age + ' 岁', 130, { fontSize: 22, lineHeight: 30, color: modern ? ink.cyan : ink.text })
        + ui.text(label, 408, { fontSize: 20, lineHeight: 30, textAlign: 'right', color: color === ink.borderLight ? ink.muted : color }),
      548, { marginBottom: 8 });
    if (item.introText) content += ui.text(item.introText, 548);
    if (item.actionText) content += ui.text('你的行动：' + item.actionText, 548, { color: ink.sub, fontSize: 24, lineHeight: 38, marginTop: 8 });
    if (item.outcomeText) content += ui.text(item.outcomeText, 548, { color: death ? ink.red : ink.text, marginTop: 8 });
    if (item.stampTag) content += ui.text('【' + item.stampTag + '】', 548, { color: ink.gold, fontSize: 24, lineHeight: 38, marginTop: 8 });
    for (const change of item.effectsText ?? item.effectsSummary ?? []) {
      const negative = /[-−]\d/.test(change);
      content += ui.text(change, 548, { fontSize: 22, lineHeight: 34, color: negative ? ink.red : change.includes('家资') ? ink.gold : ink.green, marginTop: 4 });
    }
    for (const id of item.achievementIds ?? []) {
      const earned = this.achievements.get(id);
      if (earned) content += ui.text('解锁成就：' + earned.name, 548, { color: ink.gold, fontSize: 23, lineHeight: 38, marginTop: 8 });
    }
    return ui.view(content, { width: 594, padding: 18, borderWidth: 1, borderLeftWidth: 5, borderColor: ink.border, borderLeftColor: color,
      borderRadius: 5, backgroundColor: death ? ink.ended : modern ? ink.modern : ink.panel, marginBottom: 18 });
  }

  private cardOffer(ui: Ui, card: Card, snapshot: AppSnapshot): string {
    const selected = card.id === snapshot.selectedCardId;
    const art = itemArt[card.id];
    return ui.control('card_' + card.id, card.name + ' · ' + card.rarity,
      ui.row(ui.text(card.name, 470, { fontSize: 29, lineHeight: 42 })
        + ui.text(card.rarity, 130, { color: this.rarityColor(card.rarity), textAlign: 'right', fontSize: 24 }), 606)
        + ui.text(card.description, 606, { color: ink.sub, fontSize: 25, lineHeight: 40, marginTop: 10 })
        + (card.check_bonus ? ui.text('对应检定修正 +' + card.check_bonus.amount,
          606, { color: ink.gold, fontSize: 22, lineHeight: 34, marginTop: 10 }) : '')
        + ui.row((art ? ui.image(this.platform.asset('art/items/' + art + '.png'), 54, 54) : '')
          + ui.text(selected ? '已选定' : '选择这件家当', art ? 536 : 606,
            { color: selected ? ink.cyan : ink.muted, textAlign: 'right', fontSize: 22 }), 606, { marginTop: 10 }),
      { width: 650, padding: 20, marginBottom: 16, backgroundColor: selected ? ink.selected : ink.panel,
        borderColor: selected ? ink.cyan : ink.borderLight, borderWidth: selected ? 2 : 1, borderRadius: 10 },
      () => this.controller.selectCard(card.id), { disabled: snapshot.busy, pressed: selected });
  }

  private career(ui: Ui, snapshot: AppSnapshot): string {
    const player = snapshot.view?.player;
    if (!player) return '';
    const tabs: [HubTab, string][] = [['careers', '事业'], ['modern', '现代词条'], ['relics', '家当'], ['achievements', '生涯成就']];
    let body = ui.row(tabs.map(([id, label], index) => ui.view(ui.button('hub_' + id, label, 154,
      () => { this.hubTab = id; this.selectedCareer = null; this.invalidate(); }, {
        height: 84, fontSize: 23, border: id === this.hubTab ? ink.cyan : ink.border,
        color: id === this.hubTab ? ink.cyan : ink.sub,
      }), { marginLeft: index ? 10 : 0 })).join(''), 650, { marginBottom: 20 });
    if (this.hubTab === 'careers') {
      body += ui.text('退出后已付费用不退，已学本事保留。', 650, { color: ink.sub, fontSize: 24, marginBottom: 16 });
      for (const chain of player.chains) {
        const definition = this.controller.bundle.chains.find(item => item.id === chain.chain_id);
        if (!definition) continue;
        const active = chain.status === 'active';
        const selected = chain.instance_id === this.selectedCareer;
        const content = ui.text(definition.name + (active ? selected ? ' · 已选' : ' · 进行中' : chain.status === 'completed' ? ' · 已完成' : ' · 已中断'),
          606, { color: active ? ink.gold : ink.sub, fontSize: 28 })
          + ui.text(`进展 ${chain.node_index}/${definition.nodes.length}` + (active && chain.next_due_year ? ` · 下次 ${chain.next_due_year} 年` : ''),
            606, { color: ink.sub, fontSize: 24 })
          + (definition.commitment ? ui.text(definition.commitment, 606, { color: ink.sub, fontSize: 24, lineHeight: 38, marginTop: 8 }) : '');
        body += active ? ui.control('career_' + chain.instance_id, '选择：' + definition.name, content,
          { width: 650, padding: 20, marginBottom: 16, borderColor: selected ? ink.cyan : ink.border, backgroundColor: selected ? ink.selected : ink.raised },
          () => { this.selectedCareer = chain.instance_id; this.invalidate(); }, { disabled: snapshot.busy, pressed: selected })
          : ui.view(content, { width: 650, padding: 20, marginBottom: 16, backgroundColor: ink.inset });
      }
      if (!player.chains.length) body += this.entry(ui, '暂无事业记录', '选择一条事业路线后，会在这里看到进展。');
    } else if (this.hubTab === 'modern' || this.hubTab === 'relics') {
      const cards = player.cards.map(id => this.cards.get(id)).filter((card): card is Card => Boolean(card))
        .filter(card => this.hubTab === 'modern' ? card.id.startsWith('CARD_MODERN_') : !card.id.startsWith('CARD_MODERN_'));
      for (const card of cards) body += this.entry(ui, card.name + ' · ' + card.rarity, card.description,
        this.hubTab === 'modern' ? ink.cyan : ink.gold);
      if (!cards.length) body += this.entry(ui, this.hubTab === 'modern' ? '尚无现代词条' : '尚未获得家当', '本局实际持有的物品会记在这里。');
    } else {
      const ids = new Set([...snapshot.records.achievements, ...player.achievements, ...snapshot.ending?.achievements ?? []]);
      if (snapshot.ending?.primary_achievement_id) ids.add(snapshot.ending.primary_achievement_id);
      for (const id of ids) {
        const achievement = this.achievements.get(id);
        if (achievement) body += this.entry(ui, achievement.name + ' · ' + EnumMapper.achievementMeta(achievement), achievement.text, ink.gold);
      }
      if (!ids.size) body += this.entry(ui, '本局还没有成就', '这一段人生还没留下称号。');
    }
    return body;
  }

  private ending(ui: Ui, snapshot: AppSnapshot): string {
    const report = snapshot.ending;
    if (!report) return '';
    const death = this.controller.bundle.deaths.find(item => item.id === report.death_id);
    const primary = report.primary_achievement_id ? this.achievements.get(report.primary_achievement_id) : undefined;
    let body = ui.text(`${report.start_year}—${report.end_year} · ${report.start_age}—${report.end_age} 岁 · 历经 ${report.years_played} 年`,
      650, { color: ink.sub, fontSize: 24, textAlign: 'center', marginBottom: 20 })
      + ui.text(death ? death.name + '\n' + death.text : '这段人生走到了终点。', 650,
        { fontSize: 28, lineHeight: 46, textAlign: 'center', marginBottom: 24 });
    body += ui.row([
      ['享寿', report.end_age + ' 岁', ink.green], ['积累家资', formatWealth(report.final_attributes.wealth), ink.gold],
      ['达成成就', report.achievements.length + ' 项', ink.cyan],
    ].map(([label, value, color]) => ui.view(
      ui.text(label, 202, { fontSize: 22, color: ink.sub, textAlign: 'center' })
        + ui.text(value, 202, { fontSize: 28, color, textAlign: 'center' }),
      { width: 214, paddingTop: 12, paddingBottom: 12, alignItems: 'center' })).join(''), 650, { backgroundColor: ink.inset, marginBottom: 24 });
    body += this.entry(ui, primary ? primary.name + ' · ' + EnumMapper.achievementMeta(primary) : '普通人生', primary?.text ?? '');
    body += ui.text('最高身份 · ' + EnumMapper.translateIdentity(report.highest_identity_id), 650, { color: ink.sub, marginTop: 16 });
    for (const key of attributes) body += ui.row(ui.text(EnumMapper.translateStat(key).name, 310, { fontSize: 24, color: ink.sub })
      + ui.text(key === 'wealth' ? formatWealth(report.final_attributes[key]) : String(report.final_attributes[key]), 320,
        { fontSize: 24, textAlign: 'right' }), 650, { borderBottomWidth: 1, borderColor: ink.border, paddingBottom: 8, marginTop: 8 });
    body += ui.text(`事业 · 完成 ${report.chains_completed.length} 项 / 中断 ${report.chains_interrupted.length} 项`, 650,
      { color: ink.gold, marginTop: 24 });
    for (const [status, chains] of [['完成', report.chains_completed], ['中断', report.chains_interrupted]] as const) {
      for (const chain of chains) {
        const name = this.controller.bundle.chains.find(item => item.id === chain.chain_id)?.name;
        if (name) body += ui.text(status + ' · ' + name, 650, { color: ink.sub, fontSize: 24 });
      }
    }
    for (const id of report.achievements) {
      if (id === report.primary_achievement_id) continue;
      const earned = this.achievements.get(id);
      if (earned) body += this.entry(ui, earned.name + ' · ' + EnumMapper.achievementMeta(earned), earned.text, ink.gold);
    }
    for (const id of snapshot.view?.player.cards ?? []) {
      const card = this.cards.get(id);
      if (card) body += this.entry(ui, '随身家当 · ' + card.name, card.description, ink.cyan);
    }
    return body;
  }

  private sound(ui: Ui): string {
    const settings = this.audio.getSettings();
    let body = ui.text('分别调整音乐、音效和环境声。拖动音量条，或使用加减按钮。', 650,
      { color: ink.sub, fontSize: 25, marginBottom: 24 });
    const channels: [AudioChannel, string][] = [['music', '音乐'], ['effects', '音效'], ['ambience', '环境声']];
    for (const [channel, label] of channels) {
      const value = settings[channel];
      body += ui.row(ui.text(label, 390, { fontSize: 30 })
        + ui.text(Math.round(value * 100) + '%', 240, { fontSize: 30, textAlign: 'right', color: ink.cyan }), 650, { marginTop: 16 });
      body += ui.control('volume_' + channel, label + '音量',
        ui.view(ui.view('', { width: Math.round(606 * value), height: 12, backgroundColor: ink.cyan, borderRadius: 6 }),
          { width: 606, height: 12, backgroundColor: ink.border, borderRadius: 6, marginLeft: 20 }),
        { width: 650, height: 88, justifyContent: 'center', borderWidth: 0, backgroundColor: ink.clear },
        () => undefined, { kind: 'range', value, setValue: next => { this.audio.setVolume(channel, next); this.invalidate(); } });
      body += ui.row(
        ui.button('minus_' + channel, '减小', 206, () => { this.audio.setVolume(channel, value - 0.05); this.invalidate(); }, { disabled: value <= 0 })
          + ui.view(ui.button('mute_' + channel, value > 0 ? '静音' : '恢复', 206, () => { this.audio.toggleMute(channel); this.invalidate(); }), { marginLeft: 16 })
          + ui.view(ui.button('plus_' + channel, '增大', 206, () => { this.audio.setVolume(channel, value + 0.05); this.invalidate(); }, { disabled: value >= 1 }), { marginLeft: 16 }),
        650, { marginBottom: 24 });
    }
    body += ui.button('muteAll', channels.every(([channel]) => settings[channel] === 0) ? '恢复全部声音' : '全部静音', 650,
      () => { this.audio.toggleMute(); this.invalidate(); }, { height: 88, border: ink.cyan, marginTop: 16 })
      + ui.text('设置保存在本机。切到后台时，声音与快进会暂停。\n键盘可用 Tab 切换、方向键调音量、Esc 返回。', 650,
        { color: ink.sub, fontSize: 23, lineHeight: 38, marginTop: 24 });
    return body;
  }

  private relic(ui: Ui, snapshot: AppSnapshot, height: number, safeTop: number): UiScene {
    const card = snapshot.relicId ? this.cards.get(snapshot.relicId) : undefined;
    if (!card) return ui.finish('', height, true);
    const body = ui.text(card.name + ' · ' + card.rarity, 402, { fontSize: 28, color: ink.cyan, marginBottom: 8 })
      + ui.text(card.description, 402, { fontSize: 25, lineHeight: 40 })
      + ui.text(card.check_bonus ? '对应检定修正 +' + card.check_bonus.amount
        + '\n这项加成也受检定修正上限限制。' : '本局随身家当', 402,
        { fontSize: 23, lineHeight: 36, color: ink.gold, marginTop: 16 })
      + ui.button('closeRelic', '收起详情', 402, () => this.controller.close(), { marginTop: 20, height: 84, fontSize: 24 });
    const outside = ui.control('dismissRelic', '收起物品详情', '', { width: 750, height, borderWidth: 0, backgroundColor: ink.clear }, () => this.controller.close());
    return ui.finish(outside + ui.view(body, { width: 450, padding: 22, position: 'absolute', left: 168, top: safeTop + 290,
      backgroundColor: ink.panel, borderWidth: 2, borderColor: ink.cyan, borderRadius: 10 }), height, true);
  }

  private entry(ui: Ui, title: string, text: string, color: string = ink.text): string {
    return ui.view(ui.text(title, 610, { fontSize: 28, lineHeight: 42, color })
      + (text ? ui.text(text, 610, { color: ink.sub, fontSize: 25, lineHeight: 40, marginTop: 8 }) : ''),
      { width: 650, padding: 18, backgroundColor: ink.inset, marginBottom: 16, borderRadius: 6 });
  }

  private rarityColor(rarity: string): string {
    return rarity === 'SSR' ? ink.gold : rarity === 'SR' ? ink.purple : ink.cyan;
  }
}
