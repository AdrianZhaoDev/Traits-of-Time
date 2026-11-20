import type { Card, Condition, ContentBundle, Event, Option, Outcome, Stage } from './game/core/types/content.generated';
import type { CheckPreview, GameView, PendingDecision, Timeline } from './game/core/types/schema';
import { EnumMapper } from './game/presentation/EnumMapper';

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const RISK_NAMES: Record<Option['risk'], string> = { safe: '安全', normal: '普通', high: '高风险' };

// Names identify the configured check tags, not additional card abilities.
const CHECK_TAG_NAMES: Record<string, string> = {
  farming: '农桑', medicine: '防疫', night_patrol: '夜巡', accounting: '清账',
  practical_learning: '经世', crafting: '工艺', marching: '行军', street_trade: '市井',
};

/** Keep the description intact; suppress a bonus only for the same tag and amount. */
export function cardPresentation(card: Card): { direction: string; effect: string } {
  const bonus = card.check_bonus;
  const tag = bonus && CHECK_TAG_NAMES[bonus.tag];
  if (!bonus) return { direction: '', effect: '' };
  const direction = tag ? `可能遇到与${tag}有关的经历。` : '';
  const signed = `${bonus.amount >= 0 ? '+' : ''}${bonus.amount}`;
  const amount = signed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = tag && new RegExp(`(?:^|[。；\\n])\\s*${tag}检定\\s*${amount}\\s*(?:[。；\\n]|$|，不保证(?:治愈|考中))`).test(card.description);
  return { direction, effect: exact ? '检定修正受上限限制。'
    : `${tag ? tag + '检定' : '对应标签的检定'}修正 ${signed}（受修正上限限制）。` };
}

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
  return `${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
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

export function stageMayKill(event: Event, stage: Stage): boolean {
  return [stage.success, stage.failure, ...(stage.critical_success ? [stage.critical_success] : [])]
    .some(outcome => outcomeMayKill(outcome, event, new Set<string>()));
}

function laterCareerIds(outcome: Outcome, event: Event): Set<string> {
  const ids = new Set<string>();
  const seen = new Set<string>();
  const visit = (next: Outcome): void => {
    if (next.next_stage_id === null || seen.has(next.next_stage_id)) return;
    seen.add(next.next_stage_id);
    const stage = event.stages?.find(item => item.id === next.next_stage_id);
    if (!stage) return;
    for (const branch of [stage.success, stage.failure, ...(stage.critical_success ? [stage.critical_success] : [])]) {
      for (const effect of branch.effects) if (effect.type === 'chain_start') ids.add(effect.id);
      visit(branch);
    }
  };
  visit(outcome);
  return ids;
}

/** Evaluate only the timeline constraint; unrelated requirements remain unknown. */
export function matchesTimeline(condition: Condition | undefined, timeline: Timeline): boolean | undefined {
  if (!condition) return true;
  switch (condition.op) {
    case 'is': return condition.field === 'timeline' ? condition.value === timeline : undefined;
    case 'not': {
      const match = matchesTimeline(condition.condition, timeline);
      return match === undefined ? undefined : !match;
    }
    case 'all':
    case 'any': {
      const decisive = condition.op === 'any';
      let unknown = false;
      for (const part of condition.conditions) {
        const match = matchesTimeline(part, timeline);
        if (match === decisive) return decisive;
        if (match === undefined) unknown = true;
      }
      return unknown ? undefined : !decisive;
    }
    default: return undefined;
  }
}

/** Explains production content; availability and check probabilities stay engine-owned. */
export function optionDetails(
  bundle: ContentBundle,
  event: Event,
  option: Option,
  status: Extract<PendingDecision, { kind: 'option' }>['options'][number],
  includeCalculation = false,
): string[] {
  const lines: string[] = [];
  if (option.condition && !status.available) {
    const description = EnumMapper.describeCondition(option.condition, bundle);
    // Unnamed configuration flags are not player-facing requirements; the engine
    // supplies the specific unavailable reason alongside this preview.
    if (!/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/.test(description)) lines.push(`门槛：${description}`);
  }

  for (const effect of option.outcome.effects) {
    if (effect.type === 'attribute_add' && effect.amount !== 0) {
      const amount = effect.attribute === 'wealth' ? formatWealth(effect.amount) : String(effect.amount);
      lines.push(`立即变化：${EnumMapper.translateStat(effect.attribute).name} ${effect.amount > 0 ? '+' : ''}${amount}（受属性上下限限制）`);
    }
    if (effect.type === 'chain_start') {
      const career = bundle.chains.find(chain => chain.id === effect.id);
      if (career?.commitment) lines.push(`开始前请留意：${career.commitment}`);
      else if (career) lines.push(`将开始事业：${career.name}。`);
    }
  }
  for (const id of laterCareerIds(option.outcome, event)) {
    const career = bundle.chains.find(chain => chain.id === id);
    if (career) lines.push(`后续可能开始「${career.name}」${career.commitment ? `：${career.commitment}` : '。'}`);
  }

  const immediateDeath = option.outcome.effects.some(effect => effect.type === 'death');
  if (immediateDeath) lines.push('后果：此选择会导致死亡。');
  else if (outcomeMayKill(option.outcome, event, new Set<string>())) lines.push('风险：后续阶段可能丧命。');

  for (const check of status.checks) {
    const stage = event.stages?.find(item => item.id === option.outcome.next_stage_id);
    lines.push(`后续检定：${EnumMapper.translateStat(check.attribute).name}，成功率 ${Math.round(check.success_probability * 100)}%`);
    if (includeCalculation) lines.push(...checkDetails(check, !!stage?.critical_success));
  }
  lines.push(`风险等级：${RISK_NAMES[status.risk]}`);
  return lines;
}

/** Uses the engine's immediate projected preview without recomputing its odds. */
export function checkDetails(check: CheckPreview, hasCritical: boolean): string[] {
  const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value}`;
  const lines = [
    `当前属性 ${check.attribute_value}；限幅前修正 ${signed(check.modifier_before)}，生效 ${signed(check.modifier_after)}`,
    `气数 ${check.luck_value}，独立加成 ${signed(check.luck_bonus)}`,
    `难度 ${check.dc}；原骰下限 ${check.effective_raw_minimum === null ? '无' : check.effective_raw_minimum}`,
  ];
  if (hasCritical) lines.push(`特殊大成功率 ${Math.round(check.critical_probability * 100)}%`);
  lines.push('自然 1 失败，自然 20 成功。');
  return lines;
}
