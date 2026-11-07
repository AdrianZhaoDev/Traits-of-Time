/**
 * 明末人生模拟器 - 汉化与字典映射器
 * 负责将引擎核心层数据 ID 映射为明末古风文案，严禁英文 ID 暴露给玩家
 */
import eraJson from '../../resources/data/ming_end/era.json';
import type { Achievement, Condition, ContentBundle } from '../core/types/content.generated';

export interface StatInfo {
  key: string;
  name: string;
  icon: string;
  shortName: string;
}

const REGION_MAP: Record<string, string> = {
  R_SHANBEI: '陕北·延安府',
  R_CAPITAL: '京师·顺天府',
  R_JIANGNAN: '江南·苏州府',
  R_LIAODONG: '辽东·关外卫',
};

const CASTE_MAP: Record<string, string> = {
  C_REFUGEE: '流民',
  C_SOLDIER: '军户',
  C_GENTRY: '士绅',
  C_MILITARY: '卫所武官',
  C_OUTLAW: '义军',
};

const IDENTITY_MAP: Record<string, string> = Object.fromEntries(eraJson.identities.map(identity => [identity.id, identity.name]));

const FLAG_NAMES: Record<string, string> = {
  F_MOD_CORN_PRACTICE: '完成农桑试种',
  F_MOD_HEALER_READY: '备妥防疫规程',
  F_MOD_FLASHLIGHT_READY: '备妥夜巡章程',
  F_MOD_FLASHLIGHT_MAIN_DONE: '完成夜巡主链',
  F_MOD_FLASHLIGHT_FAST_DONE: '完成甲申夜巡',
  F_MOD_CALCULATOR_ROUTE: '取得查账资历',
  F_MOD_CALCULATOR_STEP_1: '完成账房盘点',
  F_MOD_CALCULATOR_DONE: '完成清账主链',
  F_MOD_CALCULATOR_FAST_DONE: '完成甲申清账',
  F_MOD_GLUE_ARTISAN_PROOF: '取得工匠资历',
  F_MOD_GLUE_STEP_1: '完成样件安全试制',
  F_MOD_GLUE_DONE: '完成修造主链',
  F_MOD_GLUE_FAST_DONE: '完成甲申修造',
  F_MOD_LIGHTER_FUEL_EMPTY: '燃料耗尽',
  F_MOD_LIGHTER_MILITARY_RELAY: '取得行伍接力资历',
  F_MOD_LIGHTER_FIRE_TENDED: '完成火种维护',
  F_MOD_LIGHTER_STEP_1: '完成行军路线准备',
  F_MOD_LIGHTER_DONE: '完成行伍主链',
  F_MOD_LIGHTER_FAST_DONE: '完成甲申护粮',
  F_NAT_BOWL_HONEST: '保持诚信经营',
  F_NAT_BOWL_NEIGHBOR_RELIEF: '救助街坊',
  F_NAT_BOWL_STEP_1: '完成摊市起步',
  F_NAT_BOWL_DONE: '完成市井主链',
  F_NAT_BOWL_FAST_DONE: '完成甲申安摊',
  F_NAT_BOOK_IMPLEMENTED: '落实经世实务',
  F_CHAIN_IMPERIAL_EXAM_DONE: '完成科举事业',
  F_JN_JUREN: '取得乡试功名',
  F_NAT_BOOK_STEP_1: '完成读书起步',
  F_NAT_BOOK_DONE: '完成经世主链',
  F_NAT_BOOK_FAST_DONE: '完成甲申文案',
};

const STAT_MAP: Record<string, StatInfo> = {
  physique: { key: 'physique', name: '体魄', icon: '体', shortName: '体' },
  health: { key: 'physique', name: '体魄', icon: '体', shortName: '体' },
  wealth: { key: 'wealth', name: '家资', icon: '财', shortName: '财' },
  intelligence: { key: 'intelligence', name: '才干', icon: '智', shortName: '智' },
  capability: { key: 'intelligence', name: '才干', icon: '智', shortName: '智' },
  prestige: { key: 'prestige', name: '人脉', icon: '脉', shortName: '脉' },
  connection: { key: 'prestige', name: '人脉', icon: '脉', shortName: '脉' },
  luck: { key: 'luck', name: '气数', icon: '气', shortName: '气' },
  qi_yun: { key: 'luck', name: '气数', icon: '气', shortName: '气' },
};

export class EnumMapper {
  public static achievementRarity(priority: number): string {
    if (priority >= 20 && priority <= 29) return 'N';
    if (priority >= 30 && priority <= 49) return 'R';
    if (priority >= 60 && priority <= 79) return 'SR';
    if (priority >= 80 && priority <= 95) return 'SSR';
    return '';
  }

  public static achievementMeta(achievement: Pick<Achievement, 'priority' | 'category'>): string {
    const category = achievement.category === undefined ? '未分类'
      : { anecdote: '奇物轶事', milestone: '时代里程碑', life: '人生结算' }[achievement.category];
    const rarity = this.achievementRarity(achievement.priority);
    return rarity ? `${rarity} · ${category}` : category;
  }

  /** 只解释真实条件，不参与可选性判定；括号保留 all/any/not 的逻辑边界。 */
  public static describeCondition(condition: Condition, bundle: ContentBundle): string {
    switch (condition.op) {
      case 'all':
      case 'any':
        return `（${condition.conditions.map(item => this.describeCondition(item, bundle)).join(condition.op === 'all' ? ' 且 ' : ' 或 ')}）`;
      case 'not':
        return `非（${this.describeCondition(condition.condition, bundle)}）`;
      case 'compare': {
        const field = condition.field === 'age' ? '年龄' : condition.field === 'calendar_year' ? '年份'
          : condition.field === 'start_year' ? '开局年份' : this.translateStat(condition.field).name;
        const comparator = { eq: '＝', ne: '≠', lt: '＜', lte: '≤', gt: '＞', gte: '≥' }[condition.comparator];
        return `${field}${comparator}${condition.value}`;
      }
      case 'is':
        if (condition.field === 'timeline') return condition.value === 'historical' ? '历史阶段' : '架空阶段';
        return this.translate(condition.value);
      case 'has':
        if (condition.collection === 'flags') return FLAG_NAMES[condition.id] ?? condition.id;
        if (condition.collection === 'cards') return `携带${bundle.cards.find(item => item.id === condition.id)?.name ?? condition.id}`;
        if (condition.collection === 'injuries') return bundle.era.injuries.find(item => item.id === condition.id)?.name ?? condition.id;
        return `${condition.collection === 'active_chains' ? '进行' : '完成'}${bundle.chains.find(item => item.id === condition.id)?.name ?? condition.id}`;
    }
  }

  /**
   * 将地区 ID 转换为古风地名
   */
  public static translateRegion(id: string | null | undefined): string {
    if (!id) return '未知地域';
    return REGION_MAP[id] ?? id;
  }

  /**
   * 将阶层 ID 转换为古风阶层
   */
  public static translateCaste(id: string | null | undefined): string {
    if (!id) return '平民';
    return CASTE_MAP[id] ?? id;
  }

  /**
   * 将身份职业 ID 转换为古风名号
   */
  public static translateIdentity(id: string | null | undefined): string {
    if (!id) return '白丁布衣';
    return IDENTITY_MAP[id] ?? id;
  }

  /**
   * 将五维属性 Key 转换为显示名称
   */
  public static translateStat(key: string): StatInfo {
    return STAT_MAP[key] ?? { key, name: key, icon: key.slice(0, 1), shortName: key.slice(0, 1) };
  }

  /**
   * 通用枚举自动识别翻译（规范方法名）
   */
  public static translateEnum(key: string): string {
    return this.translate(key);
  }

  /**
   * 通用枚举自动识别翻译（兼容别名）
   */
  public static translate(raw: string | null | undefined): string {
    if (!raw) return '';
    if (raw in REGION_MAP) return REGION_MAP[raw];
    if (raw in CASTE_MAP) return CASTE_MAP[raw];
    if (raw in IDENTITY_MAP) return IDENTITY_MAP[raw];
    return raw;
  }
}
