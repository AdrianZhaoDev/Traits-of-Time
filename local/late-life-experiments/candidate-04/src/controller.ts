import { GameSession } from './game/application/GameSession';
import { CurrentLifeStore, type LifeRead } from './game/application/CurrentLifeStore';
import { getNativeMingEndContent } from './game/application/StaticContentLoader';
import { GameEngine } from './game/core/engine/GameEngine';
import { sha256Json } from './game/core/persistence/JsonDigest';
import type { CommandResult } from './game/core/types/commands';
import type { ContentBundle } from './game/core/types/content.generated';
import type { EndingReport, GameView, InheritanceBonus, LogEntry } from './game/core/types/schema';
import { EnumMapper } from './game/presentation/EnumMapper';
import { LifetimeRecords, type RecordStorage } from './game/presentation/LifetimeRecords';
import { isInheritanceBonus } from './game/core/engine/Inheritance';
import { collectionProgress, type CollectionProgress } from './game/presentation/CollectionProgress';
import { LogParser, type EngineRawLog, type FoldItemData } from './game/presentation/LogParser';

export type OverlayName = 'cards' | 'cardPool' | 'decision' | 'stage' | 'career' | 'ending' | 'stats' | 'achievements' | 'sound' | 'relic' | 'restart' | 'saveFailure' | 'forfeitInheritance' | 'inheritance';

export interface AppSnapshot {
  screen: 'home' | 'identity' | 'game';
  overlay: OverlayName | null;
  view: GameView | null;
  busy: boolean;
  selectedCardId: string | null;
  folds: readonly FoldItemData[];
  ending: EndingReport | null;
  notice: string;
  relicId: string | null;
  saveStatus: LifeRead['status'];
  saveBlocked: boolean;
  readOnlyReason: string | null;
  replacementTarget: string | null;
  records: ReturnType<LifetimeRecords['snapshot']>;
  selectedInheritance: InheritanceBonus | null;
  activeInheritance: InheritanceBonus | null;
  collection: CollectionProgress;
  newCollection: { achievements: string[]; deaths: string[] } | null;
}

type Listener = (snapshot: AppSnapshot, logs: readonly LogEntry[]) => void;
export const STORAGE_NOTICE = '当前人生保存在本机；清除本机数据后无法恢复。';
const AUTOMATIC_CHECK_DELAY = 220;
let lifetimeSequence = 0;

function isRequiredOverlay(name: OverlayName): boolean {
  return name === 'cards' || name === 'decision' || name === 'stage';
}

/** Owns game commands and presentation state, without a browser or Cocos runtime. */
export class GameController {
  readonly bundle: ContentBundle;
  private readonly fingerprint: string;
  private readonly lifetimeRecords: LifetimeRecords;
  private readonly lifeStore: CurrentLifeStore;
  private stored: LifeRead = { status: 'empty' };
  private restorable: GameSession | null = null;
  private saveBlocked = false;
  private overwriteAcknowledged = false;
  private restartSeed: number | undefined;
  private replacementTarget: string | null = null;
  private readonly listeners = new Set<Listener>();
  private session: GameSession | null = null;
  private screen: AppSnapshot['screen'] = 'home';
  private view: GameView | null = null;
  private busy = false;
  private selectedCardId: string | null = null;
  private selectedInheritance: InheritanceBonus | null = null;
  private activeInheritance: InheritanceBonus | null = null;
  private pendingLife: { seed: number | undefined; overwrite: boolean } | null = null;
  private newCollection: AppSnapshot['newCollection'] = null;
  private cardsRevealed = false;
  private overlays: OverlayName[] = [];
  private relicId: string | null = null;
  private notice = STORAGE_NOTICE;
  private ending: EndingReport | null = null;
  private lifeId = '';
  private recorded = false;
  private automaticSequence = 0;
  private lastLogSequence = 0;
  private rawLogs: EngineRawLog[] = [];
  private folds: FoldItemData[] = [];

  constructor(storage: RecordStorage, private readonly readOnlyReason: string | null = null) {
    const content = getNativeMingEndContent();
    this.bundle = content.bundle;
    this.fingerprint = content.fingerprint;
    const lifeStorage: RecordStorage = readOnlyReason ? {
      getItem: key => storage.getItem(key),
      setItem: () => { throw Object.assign(new Error('Read-only session'), { code: 'SAVE_FAILED' }); },
    } : storage;
    this.lifetimeRecords = new LifetimeRecords(lifeStorage);
    this.lifeStore = new CurrentLifeStore(lifeStorage);
    if (readOnlyReason) { this.readStored(); this.notice = readOnlyReason; }
    else try { this.prepareStored(); } catch (error) { this.handleStorageError(error); }
  }

  get snapshot(): AppSnapshot {
    const records = this.lifetimeRecords.snapshot();
    return {
      screen: this.screen,
      overlay: this.overlays[this.overlays.length - 1] ?? null,
      view: this.view,
      busy: this.busy,
      selectedCardId: this.selectedCardId,
      folds: this.folds,
      ending: this.ending,
      notice: this.notice,
      relicId: this.relicId,
      saveStatus: this.stored.status,
      saveBlocked: this.saveBlocked,
      readOnlyReason: this.readOnlyReason,
      replacementTarget: this.replacementTarget,
      records,
      selectedInheritance: this.selectedInheritance,
      activeInheritance: this.activeInheritance,
      collection: collectionProgress(this.bundle, records),
      newCollection: this.newCollection,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot, []);
    return () => { this.listeners.delete(listener); };
  }

  private createSession(): GameSession {
    return new GameSession(new GameEngine(this.bundle, this.fingerprint), {
      hash: sha256Json,
      persist: async save => {
        this.lifeStore.write(save, this.lifeId, this.overwriteAcknowledged);
        this.stored = { status: 'ready', save, lifeId: this.lifeId, recovered: false };
        this.restorable = null;
      },
      load: async () => {
        const stored = this.readStored();
        if (stored.status === 'ready') return stored.save;
        if (stored.status === 'empty') return null;
        throw Object.assign(new Error('Cannot read the durable current life'), { code: 'SAVE_FAILED' });
      },
    });
  }

  private readStored(): LifeRead {
    let validated: GameSession | null = null;
    const stored = this.lifeStore.read(save => {
      const session = this.createSession();
      session.restoreSave(save);
      validated = session;
    });
    this.stored = stored;
    this.restorable = stored.status === 'ready' ? validated : null;
    return stored;
  }

  private prepareStored(): LifeRead {
    this.lifetimeRecords.reload();
    const stored = this.readStored();
    this.lifetimeRecords.reconcileInheritance(
      stored.status === 'ready' ? stored.lifeId : null,
      stored.status === 'empty' || (stored.status === 'ready' && !stored.recovered),
    );
    return stored;
  }

  private blockStorage(): void {
    this.saveBlocked = true;
    this.pushOverlay('saveFailure');
    this.notice = '人生存档或传承、记录尚未确认，推进已停止。请检查本机空间和权限后重新读取。';
    this.emit();
  }

  private handleStorageError(error: unknown): void {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'SAVE_FAILED') throw error;
    this.blockStorage();
  }

  async start(seed?: number): Promise<void> {
    if (this.busy || this.saveBlocked) return;
    if (this.readOnlyReason) { this.notify(this.readOnlyReason); return; }
    try {
      const stored = this.prepareStored();
      if (stored.status === 'ready' && stored.save.engine.payload.run.ending) {
        this.lifetimeRecords.record(stored.lifeId, stored.save.engine.payload.run.ending);
      }
    } catch (error) { this.handleStorageError(error); return; }
    if (this.stored.status === 'unavailable') {
      this.notify('本机存储暂不可用，请先重新读取存档。');
      return;
    }
    if (this.stored.status !== 'empty') {
      this.restartSeed = seed;
      this.pushOverlay('restart');
      this.emit();
      return;
    }
    await this.prepareLife(seed, false);
  }

  async confirmRestart(): Promise<void> {
    if (this.busy || this.saveBlocked || this.snapshot.overlay !== 'restart') return;
    const seed = this.restartSeed;
    this.overlays.pop();
    this.restartSeed = undefined;
    await this.prepareLife(seed, true);
  }

  private async prepareLife(seed: number | undefined, overwrite: boolean): Promise<void> {
    if (this.lifetimeRecords.snapshot().inheritanceAvailable) {
      this.pendingLife = { seed, overwrite };
      this.selectedInheritance = null;
      this.pushOverlay('inheritance');
      this.emit();
    } else await this.beginLife(seed, overwrite);
  }

  selectInheritance(bonus: InheritanceBonus): void {
    if (this.busy || this.snapshot.overlay !== 'inheritance' || !this.lifetimeRecords.snapshot().inheritanceAvailable) return;
    if (!isInheritanceBonus(bonus)) { this.notify(EnumMapper.playerError('INVALID_INHERITANCE')); return; }
    if (bonus.kind === 'extra_card' && !this.bundle.pools.find(pool => pool.id === this.bundle.rules.opening.pool_id)?.entries.some(entry => entry.card_id === bonus.card_id && entry.weight > 0)) {
      this.notify(EnumMapper.playerError('INVALID_INHERITANCE'));
      return;
    }
    this.selectedInheritance = { ...bonus };
    this.emit();
  }

  async confirmInheritance(): Promise<void> {
    if (this.busy || this.saveBlocked || this.snapshot.overlay !== 'inheritance'
      || !this.lifetimeRecords.snapshot().inheritanceAvailable || !this.pendingLife) return;
    const bonus = this.selectedInheritance;
    if (!bonus) { this.notify('请先选择一项传承。'); return; }
    const { seed, overwrite } = this.pendingLife;
    await this.beginLife(seed, overwrite, bonus);
  }

  private async beginLife(seed: number | undefined, overwrite: boolean, inheritance?: InheritanceBonus): Promise<void> {
    this.resetLife();
    this.lifeId = `${Date.now()}:${++lifetimeSequence}:${Math.random().toString(36).slice(2)}`;
    this.overwriteAcknowledged = overwrite;
    this.busy = true;
    this.notice = '正在揭晓身份…';
    let reserved = false;
    try {
      this.emit();
      if (inheritance) {
        this.lifetimeRecords.reserveInheritance(this.lifeId);
        reserved = true;
      }
      const session = this.createSession();
      this.session = session;
      const result = await session.initialize(seed ?? Math.floor(Math.random() * 0x1_0000_0000), inheritance);
      if (!result.ok) {
        if (reserved) throw Object.assign(new Error('Inheritance reservation requires reconciliation'), { code: 'SAVE_FAILED' });
        this.session = null;
        this.notice = `未能开局：${EnumMapper.playerError(result.error)}`;
        return;
      }
      if (result.pending?.kind !== 'card') throw new Error('Opening card offers are missing');
      if (inheritance) this.lifetimeRecords.reconcileInheritance(this.lifeId, true);
      this.activeInheritance = inheritance ? { ...inheritance } : null;
      this.screen = 'identity';
      this.view = result.state;
      this.notice = STORAGE_NOTICE;
      const logs = this.appendLogs(result.logs);
      this.syncRequiredOverlay();
      this.emit(logs);
    } catch (error) {
      this.resetLife();
      if (reserved || (error && typeof error === 'object' && 'code' in error && error.code === 'SAVE_FAILED')) {
        this.blockStorage();
      } else this.notice = `未能开局：${EnumMapper.playerError(error)}`;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  continueLife(): void {
    if (this.busy || this.saveBlocked) return;
    if (this.readOnlyReason) {
      const stored = this.readStored();
      if (stored.status === 'ready' && stored.save.engine.payload.run.ending && this.restorable) this.restoreLoaded(stored, this.restorable);
      else this.notify(this.readOnlyReason + ' 当前没有可查看的已完成人生。');
      return;
    }
    try {
      const stored = this.prepareStored();
      if (stored.status !== 'ready' || !this.restorable) {
        this.notify(stored.status === 'incompatible' ? '旧存档与当前游戏版本不兼容，原档仍在本机。' : '未能读取可继续的人生，请重新读取存档。');
        return;
      }
      this.restoreLoaded(stored, this.restorable);
    } catch (error) { this.handleStorageError(error); }
  }

  retryStorage(): void {
    if (this.busy) return;
    if (this.readOnlyReason) {
      try { this.lifetimeRecords.reload(); } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'SAVE_FAILED') throw error;
        this.notify('本机记录暂时无法读取；请检查存储权限后重试。');
        return;
      }
      this.readStored();
      this.notify(this.readOnlyReason);
      return;
    }
    try {
      const stored = this.prepareStored();
      if (stored.status === 'unavailable') { this.blockStorage(); return; }
      this.saveBlocked = false;
      if (stored.status === 'ready' && this.restorable) {
        this.restoreLoaded(stored, this.restorable);
        return;
      }
      this.resetLife();
      this.notice = stored.status === 'empty' ? '本机没有已保存的人生，上次未确认的操作没有恢复。'
        : stored.status === 'incompatible' ? '旧存档与当前版本不兼容，原档仍在本机。'
          : '本机存档损坏，原档仍在本机。';
      this.emit();
    } catch (error) { this.handleStorageError(error); }
  }

  openForfeitInheritance(): void {
    if (this.busy || this.readOnlyReason || !this.saveBlocked || this.snapshot.overlay !== 'saveFailure'
      || !this.lifetimeRecords.snapshot().inheritancePending) return;
    this.pushOverlay('forfeitInheritance');
    this.emit();
  }

  confirmForfeitInheritance(): void {
    if (this.busy || this.readOnlyReason || !this.saveBlocked || this.snapshot.overlay !== 'forfeitInheritance') return;
    try {
      this.lifetimeRecords.reload();
      const stored = this.readStored();
      try {
        this.lifetimeRecords.reconcileInheritance(
          stored.status === 'ready' ? stored.lifeId : null,
          stored.status === 'empty' || (stored.status === 'ready' && !stored.recovered),
        );
      } catch (error) {
        if (!error || typeof error !== 'object' || !('reason' in error) || error.reason !== 'INHERITANCE_UNCERTAIN') throw error;
        this.lifetimeRecords.forfeitPendingInheritance();
      }
      this.retryStorage();
    } catch (error) { this.handleStorageError(error); }
  }

  private restoreLoaded(stored: Extract<LifeRead, { status: 'ready' }>, session: GameSession): void {
    this.resetLife();
    this.session = session;
    this.lifeId = stored.lifeId;
    const current = session.current();
    this.view = current.state;
    this.selectedCardId = stored.save.cursor.selected_card_id ?? null;
    this.activeInheritance = stored.save.engine.payload.run.inheritance;
    this.screen = current.pending?.kind === 'card' ? 'identity' : 'game';
    this.cardsRevealed = current.pending?.kind === 'card';
    this.notice = this.readOnlyReason ?? (stored.recovered ? '较新的存档无法读取，已恢复上一份有效存档。请确认后继续。' : '已恢复本机人生，当前已暂停。');
    this.appendLogs(stored.save.engine.payload.logs);
    this.syncRequiredOverlay();
    const report = stored.save.engine.payload.run.ending;
    if (report) {
      this.ending = report;
      if (!this.readOnlyReason) this.recordEnding(report);
      this.pushOverlay('ending');
    }
    this.emit();
  }

  revealCards(): void {
    if (this.busy || this.screen !== 'identity' || this.view?.pending?.kind !== 'card' || this.cardsRevealed) return;
    this.cardsRevealed = true;
    this.syncRequiredOverlay();
    this.emit();
  }

  async selectCard(id: string): Promise<void> {
    const pending = this.view?.pending;
    if (this.busy || this.saveBlocked || this.snapshot.overlay !== 'cards' || pending?.kind !== 'card') return;
    if (!pending.cards.includes(id)) {
      this.notify(EnumMapper.playerError('CARD_UNAVAILABLE'));
      return;
    }
    await this.run(async session => {
      await session.selectCardOffer(id);
      this.selectedCardId = id;
      this.emit();
    });
  }

  openCardPool(previousCardId: string): void {
    if (this.busy || this.saveBlocked || this.snapshot.overlay !== 'cards' || this.view?.pending?.kind !== 'card' || !this.view.pending.cards.includes(previousCardId)) return;
    this.replacementTarget = previousCardId;
    this.pushOverlay('cardPool');
    this.emit();
  }

  async replaceCardOffer(cardId: string): Promise<void> {
    const previousCardId = this.replacementTarget;
    if (this.busy || this.saveBlocked || this.snapshot.overlay !== 'cardPool' || !previousCardId) return;
    await this.run(async session => {
      const result = await session.command({ type: 'replaceCardOffer', previousCardId, cardId });
      if (result.ok) {
        this.selectedCardId = cardId;
        this.replacementTarget = null;
        this.overlays = this.overlays.filter(name => name !== 'cardPool');
      }
      this.accept(result);
    });
  }

  async confirmCard(): Promise<void> {
    const cardId = this.selectedCardId;
    const pending = this.view?.pending;
    if (this.busy || this.snapshot.overlay !== 'cards' || pending?.kind !== 'card') return;
    if (!cardId || !pending.cards.includes(cardId)) {
      this.notify('请先从候选家当中选择一件。');
      return;
    }
    await this.run(async session => {
      const result = await session.command({ type: 'selectCard', cardId });
      if (result.ok) {
        this.screen = 'game';
        this.cardsRevealed = false;
        this.selectedCardId = null;
      }
      if (this.accept(result)) await this.finishCurrentYear(session);
    });
  }

  async advance(): Promise<void> {
    if (this.busy || !this.session || this.screen !== 'game' || !this.view) return;
    const overlay = this.snapshot.overlay;
    if (overlay && !isRequiredOverlay(overlay)) return;
    if (this.view.status === 'ENDED') {
      this.open('ending');
      return;
    }
    if (this.view.pending?.kind === 'option') {
      this.syncRequiredOverlay();
      this.notify('请先完成当前选择，再继续往下走。');
      return;
    }
    if (this.view.pending?.kind === 'stage') {
      await this.resolveStage();
      return;
    }
    if (this.view.status !== 'READY') return;
    await this.run(async session => {
      const result = await session.command({ type: 'next' });
      if (this.accept(result)) await this.finishCurrentYear(session);
    });
  }

  async choose(id: string): Promise<void> {
    const pending = this.view?.pending;
    if (this.busy || this.snapshot.overlay !== 'decision' || pending?.kind !== 'option') return;
    const option = pending.options.find(item => item.id === id);
    if (!option?.available) {
      this.notify(option?.reason && option.reason !== 'OUTCOME_NOT_APPLICABLE'
        ? option.reason : EnumMapper.playerError('OPTION_UNAVAILABLE'));
      return;
    }
    await this.run(async session => {
      const result = await session.command({ type: 'choose', optionId: id });
      if (this.accept(result)) await this.finishCurrentYear(session);
    });
  }

  async resolveStage(): Promise<void> {
    if (this.busy || this.view?.pending?.kind !== 'stage') return;
    await this.run(session => this.finishCurrentYear(session));
  }

  async abandon(instanceId: string): Promise<void> {
    if (this.busy || !this.view || (this.view.status !== 'READY' && this.view.status !== 'AWAITING_OPTION')) return;
    await this.run(async session => {
      const result = await session.command({ type: 'abandon', chainInstanceId: instanceId });
      if (result.ok) this.overlays = this.overlays.filter(name => name !== 'career');
      if (this.accept(result)) await this.finishCurrentYear(session);
    });
  }

  open(name: 'career' | 'ending' | 'stats' | 'achievements' | 'sound'): void {
    if (name === 'career' && (this.screen !== 'game' || !this.view)) return;
    if (name === 'ending' && !this.ending) {
      this.notify('本局尚未结束。');
      return;
    }
    this.pushOverlay(name);
    this.emit();
  }

  close(): void {
    const overlay = this.snapshot.overlay;
    if (!overlay) return;
    if (overlay === 'saveFailure') return;
    if (isRequiredOverlay(overlay)) {
      this.notify(overlay === 'cards' ? '请先选定一件开局家当。'
        : overlay === 'stage' ? '请先完成当前检定。' : '请先完成当前选择。');
      return;
    }
    this.overlays.pop();
    if (overlay === 'cardPool') this.replacementTarget = null;
    if (overlay === 'inheritance') { this.pendingLife = null; this.selectedInheritance = null; }
    if (overlay === 'restart') this.restartSeed = undefined;
    if (!this.overlays.includes('relic')) this.relicId = null;
    this.emit();
  }

  home(): void {
    if (this.saveBlocked) { this.blockStorage(); return; }
    if (this.busy) {
      this.notify('当前操作尚未完成，请稍等再返回首页。');
      return;
    }
    this.resetLife();
    this.notice = this.readOnlyReason ?? STORAGE_NOTICE;
    this.emit();
  }

  inspectRelic(id: string): void {
    const pending = this.view?.pending;
    const available = this.view?.player.cards.includes(id) || (pending?.kind === 'card' && pending.cards.includes(id));
    if (!available || !this.bundle.cards.some(card => card.id === id)) return;
    this.pushOverlay('relic');
    this.relicId = id;
    this.emit();
  }

  notify(message: string): void {
    this.notice = message;
    this.emit();
  }

  private emit(logs: readonly LogEntry[] = []): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot, logs);
  }

  private resetLife(): void {
    this.session = null;
    this.screen = 'home';
    this.view = null;
    this.selectedCardId = null;
    this.selectedInheritance = null;
    this.activeInheritance = null;
    this.pendingLife = null;
    this.newCollection = null;
    this.replacementTarget = null;
    this.cardsRevealed = false;
    this.overlays = [];
    this.relicId = null;
    this.ending = null;
    this.lifeId = '';
    this.recorded = false;
    this.automaticSequence = 0;
    this.lastLogSequence = 0;
    this.rawLogs = [];
    this.folds = [];
  }

  private pushOverlay(name: OverlayName): void {
    const existing = this.overlays.indexOf(name);
    if (existing < 0) this.overlays.push(name);
    else this.overlays.splice(existing + 1);
    if (!this.overlays.includes('relic')) this.relicId = null;
  }

  private syncRequiredOverlay(): void {
    const pending = this.view?.pending;
    const required: OverlayName | null = pending?.kind === 'card' ? (this.cardsRevealed ? 'cards' : null)
      : pending?.kind === 'option' ? 'decision' : pending?.kind === 'stage' ? 'stage' : null;
    this.overlays = this.overlays.filter(name => !isRequiredOverlay(name));
    if (required) this.overlays.unshift(required);
  }

  private appendLogs(logs: readonly LogEntry[]): readonly LogEntry[] {
    const fresh = logs.filter(log => log.seq > this.lastLogSequence);
    if (!fresh.length) return fresh;
    for (const log of fresh) {
      let message = log.message;
      if (log.type === 'achievement') {
        const achievement = this.bundle.achievements.find(item => item.id === log.data.achievement_id);
        if (achievement) message = `【${achievement.name}】${achievement.text}`;
      }
      if (log.type === 'dice') {
        const event = this.bundle.events.find(item => item.id === log.source_id);
        const stage = event?.stages?.find(item => item.id === log.data.stage_id);
        const result = log.data.critical_success && stage?.critical_success ? '大成功' : log.data.success ? '成功' : '失败';
        message = `${message}（原骰 ${log.data.raw}，${result}）`;
      }
      this.rawLogs.push({
        type: log.type,
        seq: log.seq,
        age: log.age,
        source_id: log.source_id,
        message,
        metadata: log.data as Record<string, unknown>,
      });
      this.lastLogSequence = log.seq;
    }
    // Reparse the complete chronology, so an event emitted before a player choice
    // is merged with its later action/result instead of appending a duplicate fold.
    this.folds = LogParser.parseBatch(this.rawLogs);
    return fresh;
  }

  private recordEnding(report: EndingReport): void {
    const before = this.lifetimeRecords.snapshot();
    const achievements = new Set(report.achievements);
    if (report.primary_achievement_id) achievements.add(report.primary_achievement_id);
    this.newCollection = {
      achievements: this.bundle.achievements.filter(item => achievements.has(item.id) && !before.achievements.has(item.id)).map(item => item.id),
      deaths: this.bundle.deaths.filter(item => item.id === report.death_id && !before.deaths.has(item.id)).map(item => item.id),
    };
    this.lifetimeRecords.record(this.lifeId, report);
    this.recorded = true;
  }

  private accept(result: CommandResult): boolean {
    this.view = result.state;
    this.notice = result.ok ? '' : EnumMapper.playerError(result.error);
    this.syncRequiredOverlay();
    if (!result.ok) {
      this.emit();
      return false;
    }
    const logs = this.appendLogs(result.logs);
    if (result.state.status === 'ENDED' && !this.recorded && this.session) {
      const report = this.session.exportSave().engine.payload.run.ending;
      if (report) {
        this.ending = report;
        this.recordEnding(report);
        // Settings can be above the report, but an obsolete career manager cannot
        // hide the transition from a pending decision to the completed life.
        this.overlays = ['ending', ...this.overlays.filter(name => name !== 'ending' && name !== 'career')];
      }
    }
    this.emit(logs);
    return true;
  }

  private async run(operation: (session: GameSession) => Promise<void>): Promise<void> {
    const session = this.session;
    if (!session || this.busy || this.saveBlocked) return;
    if (this.readOnlyReason) { this.notify(this.readOnlyReason); return; }
    this.busy = true;
    this.notice = '';
    try {
      this.emit();
      await operation(session);
    } catch (error) {
      this.view = session.current().state;
      this.syncRequiredOverlay();
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SAVE_FAILED') {
        this.blockStorage();
      } else this.notice = EnumMapper.playerError(error);
      this.emit();
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private async showAutomaticCheck(session: GameSession): Promise<void> {
    const pending = session.current().pending;
    if (pending?.kind !== 'stage') return;
    this.notice = `检定中 · ${EnumMapper.translateStat(pending.check.attribute).name} · 成功率 ${Math.round(pending.check.success_probability * 100)}%`;
    this.emit();
    await new Promise<void>(resolve => setTimeout(resolve, AUTOMATIC_CHECK_DELAY));
  }

  private async finishCurrentYear(session: GameSession): Promise<void> {
    if (session.current().pending?.kind !== 'stage') return;
    await this.showAutomaticCheck(session);
    await session.advanceToDecision(`layout-checks:${this.automaticSequence++}`, {
      // The session's default can cross several years. A single advance/choice
      // must finish only this year's automatic stages and queued events.
      shouldStop: () => session.current().state.status === 'READY',
      onResult: async result => {
        if (this.accept(result) && result.ok && result.pending?.kind === 'stage') await this.showAutomaticCheck(session);
      },
    });
    // onResult already consumed every committed child. The returned result can be
    // the same receipt (or an empty boundary view), so never append it a second time.
  }
}
