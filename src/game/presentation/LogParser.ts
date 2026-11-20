/**
 * 将真实事件实例的日志按顺序组成故事，无法证明关联的日志独立保留。
 * 同时提供旧折页字段，供尚未使用有序段落的调用方读取。
 */
import { EnumMapper } from './EnumMapper';
export interface FoldItemData {
  age?: number;
  calendarYear?: number;
  backgroundId?: string;
  segments?: {
    kind: 'intro' | 'action' | 'dice' | 'outcome' | 'death' | 'achievement' | 'effects';
    text?: string;
    details?: string[];
    achievementId?: string;
    effectsText?: string[];
    stampTag?: string;
  }[];
  id?: string;
  eventId?: string;
  cardId?: string;
  relicFlags?: string[];
  feedbackKey?: string;
  achievementIds?: string[];
  achievementFeedbackKeys?: string[];
  introText: string;     // 起因淡墨：原 event text 或背景
  actionText?: string;    // 行动描述：option 选择等白字
  outcomeText?: string;   // 结果描述：泥金/浓墨
  stampTag?: string;      // 词条印章名（从【xxx】解析）
  effectsText?: string[]; // 属性变化摘要提示
  effectsSummary?: string[]; // 兼容别名
  type: string;           // 'history' | 'event' | 'system' | 'crisis' | 'chain' | ...
}

export interface EngineRawLog {
  type: string;
  seq?: number;
  age?: number;
  calendar_year?: number;
  message: string;
  source_id?: string;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

type FoldSegment = NonNullable<FoldItemData['segments']>[number];
export class LogParser {
  private static readonly STAMP_REGEX = /^【(.+?)】(.*)$/;

  /**
   * 将引擎返回的多条日志合并为折页渲染所需的结构化条目数组
   */
  public static parseBatch(logs: readonly EngineRawLog[] | EngineRawLog[]): FoldItemData[] {
    const items: FoldItemData[] = [];
    const eventItems = new Map<string, FoldItemData>();
    // Real engine logs have a sequence on every entry. With partial legacy data,
    // preserve the supplied order rather than inventing positions for missing seqs.
    const needsSorting = logs.every(log => Number.isSafeInteger(log.seq)) &&
      logs.some((log, index) => index > 0 && log.seq! < logs[index - 1]!.seq!);
    const ordered = needsSorting ? [...logs].sort((a, b) => a.seq! - b.seq!) : logs;
    const payloadOf = (log: EngineRawLog): Record<string, unknown> | undefined => log.metadata ?? log.data;
    const instanceOf = (log: EngineRawLog): string | undefined => {
      const id = payloadOf(log)?.event_instance_id;
      return typeof id === 'string' && id.length > 0 ? id : undefined;
    };
    const append = (current: string | undefined, text: string | undefined, separator = '\n'): string | undefined =>
      text ? current ? `${current}${separator}${text}` : text : current;

    const addSegment = (item: FoldItemData, segment: FoldSegment, feedbackKey?: string): void => {
      item.segments!.push(segment);
      switch (segment.kind) {
        case 'intro': item.introText = append(item.introText, segment.text) ?? ''; break;
        case 'action': case 'dice': item.actionText = append(item.actionText, segment.text, ' · '); break;
        case 'outcome': case 'death':
          item.outcomeText = append(item.outcomeText, segment.text);
          if (segment.stampTag) item.stampTag = segment.stampTag;
          if (segment.kind === 'death') item.type = 'death';
          break;
        case 'effects':
          if (segment.effectsText?.length) {
            (item.effectsText ??= []).push(...segment.effectsText);
            item.effectsSummary = item.effectsText;
          }
          break;
        case 'achievement':
          if (segment.achievementId) (item.achievementIds ??= []).push(segment.achievementId);
          if (feedbackKey) (item.achievementFeedbackKeys ??= []).push(feedbackKey);
          break;
      }
    };
    const makeItem = (log: EngineRawLog, index: number, type = log.type): FoldItemData => {
      const item: FoldItemData = {
        id: `${type}_${log.seq === undefined ? 'index' : 'seq'}_${log.seq ?? index}_${index}`,
        age: log.age,
        calendarYear: log.calendar_year,
        eventId: log.source_id,
        introText: '',
        type,
        segments: [],
      };
      items.push(item);
      return item;
    };
    const eventItem = (log: EngineRawLog, index: number, instanceId: string): FoldItemData => {
      const key = JSON.stringify([log.calendar_year ?? null, instanceId]);
      let item = eventItems.get(key);
      // An independent visible record must not move behind a later stage.
      // Continue the instance in a new fold when its previous fold is no longer last.
      if (!item || items[items.length - 1] !== item) {
        item = makeItem(log, index, 'event');
        item.id = `event_${key}_${log.seq ?? index}_${index}`;
        eventItems.set(key, item);
      }
      if (log.type === 'event' || log.type === 'option' || log.type === 'dice') {
        const payloadEventId = payloadOf(log)?.event_id;
        item.eventId = log.source_id || (typeof payloadEventId === 'string' ? payloadEventId : item.eventId);
      }
      return item;
    };

    let previous: EngineRawLog | undefined;
    for (let index = 0; index < ordered.length; index++) {
      const log = ordered[index]!;
      const preceding = previous;
      previous = log;
      if (
        log.type === 'skip' || log.type === 'draw' || log.type === 'late_life' ||
        log.type === 'follow_up' || log.type === 'ending' ||
        (typeof log.message === 'string' && log.message.includes('CONDITION_NOT_MET'))
      ) continue;

      const payload = payloadOf(log);
      const instanceId = instanceOf(log);
      if (log.type === 'event' || log.type === 'option' || log.type === 'dice') {
        const item = instanceId ? eventItem(log, index, instanceId) : makeItem(log, index, 'event');
        let text = this.sanitizeText(log.message);
        if (log.type === 'dice' && typeof payload?.raw === 'number' && Number.isFinite(payload.raw)) {
          // The controller may already have formatted the die and result. Do not
          // claim a special critical branch without the stage definition.
          const formattedDie = new RegExp(`（原骰\\s*${payload.raw}(?:，[^）]*)?）$`);
          if (!formattedDie.test(text)) {
            const result = typeof payload.success === 'boolean' ? `，${payload.success ? '成功' : '失败'}` : '';
            text += `（原骰 ${payload.raw}${result}）`;
          }
        }
        const segment: FoldSegment = { kind: log.type === 'event' ? 'intro' : log.type === 'option' ? 'action' : 'dice', text };
        if (log.type === 'dice') segment.details = this.describeDice(payload);
        addSegment(item, segment);
      } else if (log.type === 'effects') {
        // GameEngine logs event/option/dice and its immediate applyOutcome in the
        // same command, with no intervening record. A source ID alone is never
        // sufficient; require the full, consecutive engine context as well.
        const precedingInstance = preceding && instanceOf(preceding);
        const synchronousOutcome = preceding && precedingInstance &&
          ['event', 'option', 'dice'].includes(preceding.type) &&
          preceding.seq !== undefined && log.seq === preceding.seq + 1 &&
          log.calendar_year !== undefined && log.calendar_year === preceding.calendar_year &&
          log.age !== undefined && log.age === preceding.age &&
          !!log.source_id && log.source_id === preceding.source_id && Array.isArray(payload?.effects);
        const associatedId = instanceId ?? (synchronousOutcome ? precedingInstance : undefined);
        const item = associatedId ? eventItem(log, index, associatedId) : makeItem(log, index);
        const parsed = this.parseStamp(log.message);
        const effectsText = this.describeEffects(this.extractEffectsSummary(payload), parsed.text);
        if (parsed.text || parsed.stamp) addSegment(item, { kind: 'outcome', text: parsed.text, stampTag: parsed.stamp });
        if (effectsText?.length) addSegment(item, { kind: 'effects', effectsText });
        if (Array.isArray(payload?.effects)) {
          const flags = payload.effects.filter((effect): effect is { type: string; id: string } =>
            !!effect && typeof effect === 'object' && effect.type === 'flag_add' && typeof effect.id === 'string')
            .map(effect => effect.id);
          if (flags.length) (item.relicFlags ??= []).push(...flags);
        }
        if (log.seq !== undefined) item.feedbackKey = `effects_${log.seq}`;
      } else if (log.type === 'achievement') {
        const item = instanceId ? eventItem(log, index, instanceId) : makeItem(log, index);
        const achievementId = typeof payload?.achievement_id === 'string' ? payload.achievement_id : log.source_id;
        const feedbackKey = `achievement_${log.seq ?? `index_${index}`}`;
        addSegment(item, { kind: 'achievement', achievementId, text: this.sanitizeText(log.message) }, feedbackKey);
      } else if (log.type === 'death') {
        const item = instanceId ? eventItem(log, index, instanceId) : makeItem(log, index);
        const parsed = this.parseStamp(log.message);
        addSegment(item, { kind: 'death', text: parsed.text, stampTag: parsed.stamp || '人生结束' });
      } else if (log.type === 'card_selected') {
        const item = makeItem(log, index);
        item.cardId = typeof payload?.card_id === 'string' ? payload.card_id : undefined;
        addSegment(item, { kind: 'intro', text: this.sanitizeText(log.message) });
      } else {
        const item = makeItem(log, index);
        if (log.type === 'opening' && typeof payload?.background_id === 'string') item.backgroundId = payload.background_id;
        item.feedbackKey = log.seq === undefined ? undefined : `log_${log.seq}`;
        const parsed = this.parseStamp(log.message);
        addSegment(item, parsed.stamp
          ? { kind: 'outcome', text: parsed.text, stampTag: parsed.stamp }
          : { kind: 'intro', text: parsed.text });
      }
    }
    return items;
  }

  /** Read the executed check only from the logged result, never from a new roll. */
  private static describeDice(payload?: Record<string, unknown>): string[] | undefined {
    if (!payload) return undefined;
    const details: string[] = [];
    const addNumber = (key: string, label: string, signed = false): void => {
      const value = payload[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      details.push(`${label} ${signed && value > 0 ? '+' : ''}${value}`);
    };
    const attribute = payload.check_attribute;
    const attributeLabel = typeof attribute === 'string' && ['physique', 'intelligence', 'wealth', 'prestige'].includes(attribute)
      ? `${EnumMapper.translateStat(attribute).name}值` : '检定属性值';
    addNumber('raw', '原骰');
    addNumber('attribute_value', attributeLabel);
    addNumber('modifier_before', '修正（限幅前）', true);
    addNumber('modifier_after', '修正（限幅后）', true);
    addNumber('luck_value', '气数');
    addNumber('luck_bonus', '气数加成', true);
    addNumber('dc', '难度');
    if (payload.effective_raw_minimum === null) details.push('原骰下限 无');
    else addNumber('effective_raw_minimum', '原骰下限');
    if (typeof payload.success_probability === 'number' && Number.isFinite(payload.success_probability)) {
      details.push(`成功率 ${Math.round(payload.success_probability * 100)}%`);
    }
    if (typeof payload.critical_probability === 'number' && Number.isFinite(payload.critical_probability)) {
      details.push(`满足大成功条件的概率 ${Math.round(payload.critical_probability * 100)}%`);
    }
    if (typeof payload.success === 'boolean') details.push(`本次检定 ${payload.success ? '成功' : '失败'}`);
    if (typeof payload.critical_success === 'boolean') details.push(`大成功条件 ${payload.critical_success ? '满足' : '未满足'}`);
    return details.length ? details : undefined;
  }

  /** Keep configured amounts distinct from unobserved, potentially clamped changes. */
  private static describeEffects(effects: string[] | undefined, narrative: string): string[] | undefined {
    if (!effects?.length) return effects;
    const remaining = new Map<string, number>();
    return effects.map(effect => {
      let count = remaining.get(effect);
      if (count === undefined) {
        const clauses = narrative.split(/[，,。；;！!？?\n]/).map(clause => clause.trim());
        const escaped = effect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        count = clauses.filter(clause => clause === effect).length;
        count += [...narrative.matchAll(new RegExp(`[（(]${escaped}[）)]`, 'g'))].length;
      }
      remaining.set(effect, Math.max(0, count - 1));
      if (count > 0) return `${effect.slice(0, effect.lastIndexOf(' '))}实际变化可能受上下限限制`;
      return `${effect}（实际变化可能受上下限限制）`;
    });
  }

  /**
   * 净化文本中的内部英文属性代码与调试枚举，如 (+1 qi_yun...) 转换为中文或剔除
   */
  public static sanitizeText(text: string): string {
    if (!text) return '';
    // 替换类似 ( physique +1 ), (+1 qi_yun), (-2 wealth), (+1 physique) 等英文属性代码
    return text
      .replace(/\(\s*([+-]?\d+)\s*([a-zA-Z_]+)\s*\)/g, (_match, delta, statKey) => {
        const statInfo = EnumMapper.translateStat(statKey);
        const sign = Number(delta) > 0 ? `+${Number(delta)}` : `${Number(delta)}`;
        return `(${statInfo.name} ${sign})`;
      })
      .replace(/\(\s*([a-zA-Z_]+)\s*([+-]?\d+)\s*\)/g, (_match, statKey, delta) => {
        const statInfo = EnumMapper.translateStat(statKey);
        const sign = Number(delta) > 0 ? `+${Number(delta)}` : `${Number(delta)}`;
        return `(${statInfo.name} ${sign})`;
      })
      .replace(/CONDITION_NOT_MET/g, '')
      .trim();
  }

  /**
   * 从【词条】格式中提取印章标签与正文
   */
  public static parseStamp(rawText: string): { stamp?: string; text: string } {
    if (!rawText) return { text: '' };
    const cleaned = this.sanitizeText(rawText);
    const match = cleaned.match(this.STAMP_REGEX);
    if (match) {
      return {
        stamp: match[1],
        text: match[2].trim(),
      };
    }
    return { text: cleaned };
  }
  /**
   * 从 metadata.effects 中提取可读的属性变化摘要
   */
  private static extractEffectsSummary(metadata?: Record<string, unknown>): string[] | undefined {
    if (!metadata || !Array.isArray(metadata.effects)) return undefined;
    const summaries: string[] = [];
    for (const eff of metadata.effects) {
      if (!eff || typeof eff !== 'object') continue;
      const effectObj = eff as Record<string, unknown>;
      if (effectObj.type === 'attribute_delta' && typeof effectObj.field === 'string') {
        const delta = Number(effectObj.delta);
        if (!isNaN(delta) && delta !== 0) {
          const statInfo = EnumMapper.translateStat(effectObj.field);
          const sign = delta > 0 ? `+${delta}` : `${delta}`;
          summaries.push(`${statInfo.name} ${sign}`);
        }
      } else if (effectObj.type === 'attribute_add' && typeof effectObj.attribute === 'string') {
        const amount = Number(effectObj.amount);
        if (!isNaN(amount) && amount !== 0) {
          const statInfo = EnumMapper.translateStat(effectObj.attribute);
          const sign = amount > 0 ? `+${amount}` : `${amount}`;
          // The display layer labels configured changes as potentially clamped.
          summaries.push(`${statInfo.name} ${sign}`);
        }
      }
    }
    return summaries.length > 0 ? summaries : undefined;
  }
}
