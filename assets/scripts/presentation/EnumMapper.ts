/**
 * 明末人生模拟器 - 汉化与字典映射器
 * 负责将引擎核心层数据 ID 映射为明末古风文案，严禁英文 ID 暴露给玩家
 */

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

const IDENTITY_MAP: Record<string, string> = {
  I_YOUTH: '总角幼童',
  I_DEPENDENT: '宗族子弟',
  I_REFUGEE: '逃荒流民',
  I_WORKER: '作坊帮工',
  I_HOUSEHOLD: '军户余丁',
  I_MILITARY_OFFICER: '卫所旗官',
  I_SILK_MERCHANT: '绸缎巨贾',
  I_JUREN: '乡试举人',
  I_ARTISAN: '军匠百工',
  I_HEALER: '悬壶医家',
  I_MARITIME_MERCHANT: '海商掌柜',
  I_COMMUNITY_LEADER: '乡党领袖',
  I_WAREHOUSE_OVERSEER: '仓廪司库',
  I_CLAN_ELDER: '宗族耆老',
  I_TENANT: '佃农雇工',
  I_SCHOLAR: '县学庠生',
  I_MERCHANT: '行商走贩',
  I_SOLDIER: '营兵精锐',
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
