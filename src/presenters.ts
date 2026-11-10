import type { ContentBundle, Event, Option, Outcome } from './game/core/types/content.generated';
import type { GameView, PendingDecision } from './game/core/types/schema';
import { EnumMapper } from './game/presentation/EnumMapper';

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const RISK_NAMES: Record<Option['risk'], string> = { safe: '安全', normal: '普通', high: '高风险' };

function chineseYearNumber(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 99) return String(value);
  if (value < 10) return DIGITS[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
}

export function yearHeading(view: GameView): string {
  const year = view.player.calendar_year;
  if (view.timeline !== 'historical') return `架空人生 · ${year}`;
  const cycle = ((year - 4) % 60 + 60) % 60;
  return `崇祯${chineseYearNumber(year - 1627)}年 · 岁次${STEMS[cycle % 10]}${BRANCHES[cycle % 12]}`;
}

export function formatWealth(value: number): string {
  const [integer, fraction] = String(value).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${fraction === undefined ? '' : `.${fraction}`}两`;
}

function outcomeMayKill(outcome: Outcome, event: Event, seen: Set<string>): boolean {
  if (outcome.effects.some(effect => effect.type === 'death')) return true;
  if (outcome.next_stage_id === null || seen.has(outcome.next_stage_id)) return false;
  seen.add(outcome.next_stage_id);
  const stage = event.stages?.find(item => item.id === outcome.next_stage_id);
  if (!stage) return false;
  return outcomeMayKill(stage.success, event, seen)
    || outcomeMayKill(stage.failure, event, seen)
    || (stage.critical_success !== undefined && outcomeMayKill(stage.critical_success, event, seen));
}

/** Explains production content; availability and check probabilities stay engine-owned. */
export function optionDetails(
  bundle: ContentBundle,
  event: Event,
  option: Option,
  status: Extract<PendingDecision, { kind: 'option' }>['options'][number],
): string[] {
  const lines: string[] = [];
  if (option.condition && !status.available) {
    const description = EnumMapper.describeCondition(option.condition, bundle);
    // Unnamed configuration flags are not player-facing requirements; the engine
    // supplies the specific unavailable reason alongside this preview.
    if (!/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/.test(description)) lines.push(`门槛：${description}`);
  }

  for (const effect of option.outcome.effects) {
    if (effect.type === 'attribute_add' && effect.amount < 0) {
      const amount = effect.attribute === 'wealth' ? formatWealth(effect.amount) : String(effect.amount);
      lines.push(`立即消耗：${EnumMapper.translateStat(effect.attribute).name} ${amount}`);
    }
    if (effect.type === 'chain_start') {
      const commitment = bundle.chains.find(chain => chain.id === effect.id)?.commitment;
      if (commitment) lines.push(`开始前请留意：${commitment}`);
    }
  }

  const immediateDeath = option.outcome.effects.some(effect => effect.type === 'death');
  if (immediateDeath) lines.push('后果：此选择会导致死亡。');
  else if (outcomeMayKill(option.outcome, event, new Set<string>())) lines.push('风险：后续阶段可能丧命。');

  for (const check of status.checks) {
    lines.push(`后续检定：${EnumMapper.translateStat(check.attribute).name}，成功率 ${Math.round(check.success_probability * 100)}%`);
  }
  lines.push(`风险等级：${RISK_NAMES[status.risk]}`);
  return [...new Set(lines)];
}
