import { GameSession, type SessionSave } from '../../assets/scripts/application/GameSession';
import { getNativeMingEndContent } from '../../assets/scripts/application/NativeContentLoader';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine';
import { sha256Json } from '../../assets/scripts/core/persistence/JsonDigest';
import type { CommandResult } from '../../assets/scripts/core/types/commands';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated';
import type { EndingReport, GameView, LogEntry } from '../../assets/scripts/core/types/schema';
import { EnumMapper } from '../../assets/scripts/presentation/EnumMapper';
import { LifetimeRecords, type RecordStorage } from '../../assets/scripts/presentation/LifetimeRecords';
import { LogParser, type EngineRawLog, type FoldItemData } from '../../assets/scripts/presentation/LogParser';

export type OverlayName = 'cards' | 'decision' | 'stage' | 'career' | 'ending' | 'stats' | 'achievements' | 'sound' | 'relic';

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
  records: ReturnType<LifetimeRecords['snapshot']>;
}

type Listener = (snapshot: AppSnapshot, logs: readonly LogEntry[]) => void;
const MEMORY_NOTICE = '当前人生仅在内存暂存，刷新、离开或返回首页会丢失；本机只保存已完成人生记录与音量设置。';
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
  private readonly listeners = new Set<Listener>();
  private session: GameSession | null = null;
  private screen: AppSnapshot['screen'] = 'home';
  private view: GameView | null = null;
  private busy = false;
  private selectedCardId: string | null = null;
  private cardsRevealed = false;
  private overlays: OverlayName[] = [];
  private relicId: string | null = null;
  private notice = MEMORY_NOTICE;
  private ending: EndingReport | null = null;
  private lifeId = '';
  private recorded = false;
  private automaticSequence = 0;
  private lastLogSequence = 0;
  private rawLogs: EngineRawLog[] = [];
  private folds: FoldItemData[] = [];

  constructor(storage: RecordStorage) {
    const content = getNativeMingEndContent();
    this.bundle = content.bundle;
    this.fingerprint = content.fingerprint;
    this.lifetimeRecords = new LifetimeRecords(storage);
  }

  get snapshot(): AppSnapshot {
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
      records: this.lifetimeRecords.snapshot(),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot, []);
    return () => { this.listeners.delete(listener); };
  }

  async start(seed?: number): Promise<void> {
    if (this.busy) return;
    this.resetLife();
    this.busy = true;
    this.notice = '正在揭晓身份…';
    try {
      this.emit();
      // GameSession still owns commits and replay cursors. This slot is deliberately
      // transient: only LifetimeRecords receives the platform storage port.
      let saveSlot: SessionSave | null = null;
      const session = new GameSession(new GameEngine(this.bundle, this.fingerprint), {
        hash: sha256Json,
        persist: async save => { saveSlot = save; },
        load: async () => saveSlot,
      });
      this.session = session;
      const result = await session.initialize(seed ?? Math.floor(Math.random() * 0x1_0000_0000));
      if (!result.ok) {
        this.session = null;
        this.notice = `未能开局：${EnumMapper.playerError(result.error)}`;
        return;
      }
      if (result.pending?.kind !== 'card') {
        this.session = null;
        this.notice = '开局家当候选未能载入，请重新开始。';
        return;
      }
      this.lifeId = `${Date.now()}:${++lifetimeSequence}:${Math.random().toString(36).slice(2)}`;
      this.screen = 'identity';
      this.view = result.state;
      this.notice = MEMORY_NOTICE;
      const logs = this.appendLogs(result.logs);
      this.syncRequiredOverlay();
      this.emit(logs);
    } catch (error) {
      this.resetLife();
      this.notice = `未能开局：${EnumMapper.playerError(error)}`;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  revealCards(): void {
    if (this.busy || this.screen !== 'identity' || this.view?.pending?.kind !== 'card' || this.cardsRevealed) return;
    this.cardsRevealed = true;
    this.selectedCardId = null;
    this.syncRequiredOverlay();
    this.emit();
  }

  selectCard(id: string): void {
    const pending = this.view?.pending;
    if (this.busy || this.snapshot.overlay !== 'cards' || pending?.kind !== 'card') return;
    if (!pending.cards.includes(id)) {
      this.notify(EnumMapper.playerError('CARD_UNAVAILABLE'));
      return;
    }
    this.selectedCardId = id;
    this.emit();
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
    if (isRequiredOverlay(overlay)) {
      this.notify(overlay === 'cards' ? '请先选定一件开局家当。'
        : overlay === 'stage' ? '请先完成当前检定。' : '请先完成当前选择。');
      return;
    }
    this.overlays.pop();
    if (!this.overlays.includes('relic')) this.relicId = null;
    this.emit();
  }

  home(): void {
    if (this.busy) {
      this.notify('当前操作尚未完成，请稍等再返回首页。');
      return;
    }
    this.resetLife();
    this.notice = MEMORY_NOTICE;
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
        this.lifetimeRecords.record(this.lifeId, report);
        this.recorded = true;
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
    if (!session || this.busy) return;
    this.busy = true;
    this.notice = '';
    try {
      this.emit();
      await operation(session);
    } catch (error) {
      this.view = session.current().state;
      this.syncRequiredOverlay();
      this.notice = EnumMapper.playerError(error);
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
