/**
 * 明末人生模拟器 - 日志结构化解析与折页卡片聚合器
 * 核心职责：
 * 1. 拦截引擎分开发出的 event 起因与 effects 结果，聚合成单张折页卡片，杜绝日志重复平铺
 * 2. 提取【词条】朱砂印章标识与正文描述
 * 3. 提炼属性数值变动的直观文案
 */
import { EnumMapper } from './EnumMapper';
export interface FoldItemData {
  age?: number;
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
  message: string;
  source_id?: string;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
}
export class LogParser {
  private static readonly STAMP_REGEX = /^【(.+?)】(.*)$/;

  /**
   * 将引擎返回的多条日志合并为折页渲染所需的结构化条目数组
   */
  public static parseBatch(logs: readonly EngineRawLog[] | EngineRawLog[]): FoldItemData[] {
    const items: FoldItemData[] = [];
    let pendingEventItem: FoldItemData | null = null;
    let pendingSourceId: string | undefined = undefined;
    let lastIntroText: string | null = null;
    let currentAge: number | undefined;
    const addItem = (item: FoldItemData): void => {
      if (item.age === undefined) item.age = currentAge;
      items.push(item);
    };

    for (const log of logs) {
      currentAge = log.age;
      // 过滤系统状态码与内部跳过日志（不生成卡片）
      if (
        log.type === 'skip' ||
        log.type === 'draw' ||
        log.type === 'ending' ||
        log.message === 'CONDITION_NOT_MET' ||
        (typeof log.message === 'string' && log.message.includes('CONDITION_NOT_MET'))
      ) {
        continue;
      }

      const payload = log.metadata ?? log.data;
      if (log.type === 'card_selected') {
        if (pendingEventItem) addItem(pendingEventItem);
        pendingEventItem = null;
        pendingSourceId = undefined;
        const cardId = typeof payload?.card_id === 'string' ? payload.card_id : undefined;
        addItem({ id: `card_${cardId ?? ''}`, cardId, introText: this.sanitizeText(log.message), type: 'card_selected' });
        continue;
      }
      if (log.type === 'event') {
        // 拦截连续重复的起因文本
        if (log.message && log.message === lastIntroText) {
          continue;
        }
        lastIntroText = log.message;

        // 如果之前有暂存未匹配 effects 的 event，先推入结果
        if (pendingEventItem) {
          addItem(pendingEventItem);
          pendingEventItem = null;
          pendingSourceId = undefined;
        }

        const eventInstanceId = (payload?.event_instance_id as string) || (payload?.event_id as string);
        const sourceId = log.source_id || eventInstanceId;
        const id = eventInstanceId || sourceId || `evt_${Date.now()}_${Math.random()}`;
        pendingSourceId = sourceId;
        const cleanedIntro = this.sanitizeText(log.message);
        pendingEventItem = {
          id,
          eventId: log.source_id || (typeof payload?.event_id === 'string' ? payload.event_id : undefined) || eventInstanceId,
          introText: cleanedIntro,
          type: 'event',
        };
      } else if (log.type === 'option') {
        // 玩家行动（白字）：合并进同一个事件卡片
        const cleanedOpt = this.sanitizeText(log.message);
        if (pendingEventItem) {
          pendingEventItem.actionText = cleanedOpt;
        } else {
          const id = `act_${Date.now()}_${Math.random()}`;
          pendingSourceId = log.source_id;
          pendingEventItem = {
            id,
            eventId: log.source_id,
            introText: '',
            actionText: cleanedOpt,
            type: 'event',
          };
        }
      } else if (log.type === 'dice') {
        // 阶段检定描述（如粮棚旧墙碎土避险检定等）：合并为 actionText
        const cleanedDice = this.sanitizeText(log.message);
        if (pendingEventItem) {
          pendingEventItem.actionText = pendingEventItem.actionText ? `${pendingEventItem.actionText} · ${cleanedDice}` : cleanedDice;
        } else {
          const id = `dice_${Date.now()}_${Math.random()}`;
          pendingSourceId = log.source_id;
          pendingEventItem = {
            id,
            eventId: log.source_id,
            introText: '',
            actionText: cleanedDice,
            type: 'event',
          };
        }
      } else if (log.type === 'effects') {
        // 尝试解析是否包含【词条】
        const parsed = this.parseStamp(log.message);
        const effectsText = this.extractEffectsSummary(payload);
        const effectSourceId = log.source_id;
        const relicFlags = Array.isArray(payload?.effects)
          ? payload.effects.filter((effect): effect is { type: string; id: string } =>
            !!effect && typeof effect === 'object' && effect.type === 'flag_add' && typeof effect.id === 'string')
            .map(effect => effect.id)
          : [];
        const feedbackKey = log.seq === undefined ? undefined : `effects_${log.seq}`;

        const canMerge =
          pendingEventItem &&
          (!effectSourceId || !pendingSourceId || effectSourceId === pendingSourceId || pendingEventItem.eventId === effectSourceId);

        if (canMerge && pendingEventItem) {
          // 合并到前一个起因/行动事件中，形成同一年起因+行动+结果一体折页
          pendingEventItem.outcomeText = parsed.text;
          pendingEventItem.stampTag = parsed.stamp;
          pendingEventItem.effectsText = effectsText;
          pendingEventItem.effectsSummary = effectsText;
          pendingEventItem.relicFlags = relicFlags;
          pendingEventItem.feedbackKey = feedbackKey;
          addItem(pendingEventItem);
          pendingEventItem = null;
          pendingSourceId = undefined;
        } else {
          // 独立结果项
          const id = `eff_${Date.now()}_${Math.random()}`;
          addItem({
            id,
            eventId: effectSourceId,
            relicFlags,
            feedbackKey,
            introText: '',
            outcomeText: parsed.text,
            stampTag: parsed.stamp,
            effectsText,
            effectsSummary: effectsText,
            type: 'effects',
          });
        }
      } else if (log.type === 'death') {
        // 将死因合入当前事件；结算概览由主界面单独展示，避免重复评语。
        const parsed = this.parseStamp(log.message);
        const stampTag = parsed.stamp || '人生结束';
        const deathText = parsed.text;
        const orphanedAchievement = items[items.length - 1]?.type === 'achievement' ? items.pop() : undefined;
        if (pendingEventItem) {
          pendingEventItem.outcomeText = deathText;
          pendingEventItem.stampTag = stampTag;
          pendingEventItem.type = 'death';
          if (orphanedAchievement) {
            pendingEventItem.achievementIds = orphanedAchievement.achievementIds;
            pendingEventItem.achievementFeedbackKeys = orphanedAchievement.achievementFeedbackKeys;
          }
          addItem(pendingEventItem);
          pendingEventItem = null;
          pendingSourceId = undefined;
        } else {
          const id = `death_${Date.now()}_${Math.random()}`;
          addItem({
            id,
            eventId: log.source_id,
            achievementIds: orphanedAchievement?.achievementIds,
            achievementFeedbackKeys: orphanedAchievement?.achievementFeedbackKeys,
            introText: '',
            outcomeText: deathText,
            stampTag,
            type: 'death',
          });
        }
      } else if (log.type === 'achievement') {
        if (pendingEventItem) {
          addItem(pendingEventItem);
          pendingEventItem = null;
          pendingSourceId = undefined;
        }
        const achievementId = typeof payload?.achievement_id === 'string'
          ? payload.achievement_id
          : log.source_id;
        const feedbackKey = log.seq === undefined
          ? achievementId ?? `achievement_${Date.now()}_${Math.random()}`
          : `achievement_${log.seq}`;
        const previous = items[items.length - 1];
        if (achievementId && previous && ['event', 'effects', 'chain', 'death'].includes(previous.type)) {
          previous.achievementIds = [...(previous.achievementIds ?? []), achievementId];
          previous.achievementFeedbackKeys = [...(previous.achievementFeedbackKeys ?? []), feedbackKey];
          continue;
        }
        addItem({
          id: `achievement_${achievementId ?? ''}`,
          eventId: achievementId,
          achievementIds: achievementId ? [achievementId] : [],
          achievementFeedbackKeys: [feedbackKey],
          introText: '',
          type: 'achievement',
        });
      } else {
        // 其它日志 (history, system, chain, achievement 等)
        if (pendingEventItem) {
          addItem(pendingEventItem);
          pendingEventItem = null;
          pendingSourceId = undefined;
        }

        const parsed = this.parseStamp(log.message);
        addItem({
          id: `log_${Date.now()}_${Math.random()}`,
          eventId: log.source_id,
          feedbackKey: log.seq === undefined ? undefined : `log_${log.seq}`,
          introText: parsed.stamp ? '' : parsed.text,
          outcomeText: parsed.stamp ? parsed.text : undefined,
          stampTag: parsed.stamp,
          type: log.type,
        });
      }
    }

    if (pendingEventItem) {
      addItem(pendingEventItem);
    }

    return items;
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
          summaries.push(`${statInfo.name} ${sign}`);
        }
      }
    }
    return summaries.length > 0 ? summaries : undefined;
  }
}
