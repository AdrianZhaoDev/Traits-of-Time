import type { Condition, ContentBundle, Effect, Event, Outcome } from '../types/content.generated.js';
import { evaluateCondition, type ConditionContext } from '../engine/ConditionEvaluator.js';
import { validateStructure } from './SchemaValidator.js';
import { type ContentIssueCode, type ValidationIssue, type ValidationResult } from './Validation.js';
export type { ContentIssueCode, ValidationIssue, ValidationResult } from './Validation.js';

const UINT32_RANGE = 2 ** 32;
const attributes = ['physique', 'intelligence', 'wealth', 'prestige', 'luck'] as const;


function ageBreakpoints(condition: Condition | undefined, values: Set<number>): void {
  if (!condition) return;
  if (condition.op === 'all' || condition.op === 'any') condition.conditions.forEach((child) => ageBreakpoints(child, values));
  else if (condition.op === 'not') ageBreakpoints(condition.condition, values);
  else if (condition.op === 'compare' && condition.field === 'age') {
    for (const rounded of [Math.floor(condition.value), Math.ceil(condition.value)]) {
      for (const delta of [-1, 0, 1]) {
        const candidate = rounded + delta;
        if (Number.isSafeInteger(candidate)) values.add(candidate);
      }
    }
  }
}

class SemanticValidator {
  readonly issues: ValidationIssue[] = [];
  private readonly references: Record<string, Set<string>>;
  private readonly eventById: Map<string, Event>;
  private backgroundConditionsValid = true;

  constructor(private readonly content: ContentBundle) {
    this.references = Object.create(null) as Record<string, Set<string>>;
    for (const key of ['regions', 'castes', 'cards', 'pools', 'events', 'chains', 'achievements', 'deaths'] as const) {
      this.references[key] = new Set(content[key].map((item) => item.id));
    }
    for (const key of ['backgrounds', 'identities', 'injuries'] as const) this.references[key] = new Set(content.era[key].map((item) => item.id));
    this.eventById = new Map(content.events.map((event) => [event.id, event]));
  }

  private issue(file: string, path: string, code: ContentIssueCode, message: string): void {
    if (!this.issues.some((issue) => issue.file === file && issue.path === path && issue.code === code && issue.message === message)) {
      this.issues.push({ file, path, code, message });
    }
  }

  private reference(collection: string, id: string, file: string, path: string): void {
    if (!this.references[collection]?.has(id)) this.issue(file, path, 'MISSING_REFERENCE', `引用不存在的 ${collection} ID：${id}。`);
  }

  private unique(items: readonly { id: string }[], file: string, path: string): void {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      if (ids.has(item.id)) this.issue(file, `${path}/${index}/id`, 'DUPLICATE_ID', `ID 重复：${item.id}。`);
      ids.add(item.id);
    });
  }

  private distribution(weights: readonly number[], file: string, path: string, requirePositive = true): void {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!Number.isFinite(total) || (requirePositive && total <= 0)) {
      this.issue(file, path, 'INVALID_DISTRIBUTION', '抽样权重总和必须有限，且需要候选时必须大于零。');
    }
  }

  private uniform(min: number, max: number, file: string, path: string): void {
    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span < 1 || span > UINT32_RANGE) {
      this.issue(file, path, 'INVALID_DISTRIBUTION', '均匀整数区间必须非空且跨度不超过 2^32。');
    }
  }

  private condition(condition: Condition | undefined, file: string, path: string, background = false, depth = 1): void {
    if (!condition) return;
    if (depth > 8) {
      this.issue(file, path, 'INVALID_COMBINATION', '条件嵌套深度不能超过 8。');
      if (background) this.backgroundConditionsValid = false;
      return;
    }
    if (background && !(
      condition.op === 'all' || condition.op === 'any' || condition.op === 'not'
      || (condition.op === 'compare' && condition.field === 'age')
      || (condition.op === 'is' && (condition.field === 'region_id' || condition.field === 'caste_id'))
    )) {
      this.issue(file, path, 'INVALID_COMBINATION', '生平条件只能依赖年龄、地区和门第。');
      this.backgroundConditionsValid = false;
    }
    switch (condition.op) {
      case 'all':
      case 'any':
        condition.conditions.forEach((child, index) => this.condition(child, file, `${path}/conditions/${index}`, background, depth + 1));
        break;
      case 'not': this.condition(condition.condition, file, `${path}/condition`, background, depth + 1); break;
      case 'has':
        if (condition.collection !== 'flags') {
          this.reference(condition.collection === 'completed_chains' || condition.collection === 'active_chains' ? 'chains' : condition.collection, condition.id, file, `${path}/id`);
        }
        break;
      case 'is':
        if (condition.field !== 'timeline') {
          const collection = condition.field === 'region_id' ? 'regions' : condition.field === 'caste_id' ? 'castes' : 'identities';
          this.reference(collection, condition.value, file, `${path}/value`);
        }
        break;
      case 'compare': break;
    }
  }

  private effects(effects: readonly Effect[], file: string, path: string): void {
    const flags = new Map<string, string>();
    const injuries = new Map<string, string>();
    let region: string | undefined;
    let identity: string | undefined;
    let deathCount = 0;
    effects.forEach((effect, index) => {
      const effectPath = `${path}/${index}`;
      switch (effect.type) {
        case 'flag_add':
        case 'flag_remove': {
          const previous = flags.get(effect.id);
          if (previous && previous !== effect.type) this.issue(file, effectPath, 'INVALID_COMBINATION', '同一结果不能同时添加和移除同一标记。');
          flags.set(effect.id, effect.type);
          break;
        }
        case 'injury_add':
        case 'injury_remove': {
          this.reference('injuries', effect.id, file, `${effectPath}/id`);
          const previous = injuries.get(effect.id);
          if (previous && previous !== effect.type) this.issue(file, effectPath, 'INVALID_COMBINATION', '同一结果不能同时添加和移除同一伤病。');
          injuries.set(effect.id, effect.type);
          break;
        }
        case 'region_set':
          this.reference('regions', effect.id, file, `${effectPath}/id`);
          if (region !== undefined && region !== effect.id) this.issue(file, effectPath, 'INVALID_COMBINATION', '同一结果不能设置不同地区。');
          region = effect.id;
          break;
        case 'identity_set':
          this.reference('identities', effect.id, file, `${effectPath}/id`);
          if (identity !== undefined && identity !== effect.id) this.issue(file, effectPath, 'INVALID_COMBINATION', '同一结果不能设置不同身份。');
          identity = effect.id;
          break;
        case 'chain_start': this.reference('chains', effect.id, file, `${effectPath}/id`); break;
        case 'ending_unlock': this.reference('achievements', effect.id, file, `${effectPath}/id`); break;
        case 'death':
          this.reference('deaths', effect.id, file, `${effectPath}/id`);
          deathCount++;
          if (deathCount > 1 || index !== effects.length - 1) this.issue(file, effectPath, 'INVALID_COMBINATION', '死亡只能出现一次且必须是最后一个效果。');
          break;
        case 'attribute_add': {
          const { min, max } = this.content.rules.attributes;
          if (!Number.isFinite(min + effect.amount) || !Number.isFinite(max + effect.amount)) {
            this.issue(file, `${effectPath}/amount`, 'INVALID_COMBINATION', '属性变化会产生非有限数值。');
          }
          break;
        }
      }
    });
  }

  private outcome(outcome: Outcome, file: string, path: string, stageIds?: ReadonlySet<string>, completion = false): void {
    this.effects(outcome.effects, file, `${path}/effects`);
    if (outcome.next_stage_id !== null) {
      if (!stageIds?.has(outcome.next_stage_id)) this.issue(file, `${path}/next_stage_id`, 'MISSING_REFERENCE', `阶段不存在：${outcome.next_stage_id}。`);
      if (completion) this.issue(file, `${path}/next_stage_id`, 'INVALID_COMBINATION', '任务完成结果不能继续事件阶段。');
    }
    if (outcome.effects.some((effect) => effect.type === 'death')) {
      if (outcome.next_stage_id !== null || outcome.effects.some((effect) =>
        effect.type === 'chain_start' || effect.type === 'ending_unlock' || (effect.type === 'attribute_add' && effect.amount > 0)
      ) || outcome.effects[outcome.effects.length - 1]?.type !== 'death') {
        this.issue(file, path, 'INVALID_COMBINATION', '死亡结果不能奖励正属性、启动任务、解锁结局或继续阶段；死亡必须在最后。');
      }
    }
    if (completion) outcome.effects.forEach((effect, index) => {
      if (effect.type === 'chain_start' || effect.type === 'death') this.issue(file, `${path}/effects/${index}`, 'INVALID_COMBINATION', '任务完成结果不能启动任务或死亡。');
    });
  }

  private event(event: Event, index: number): void {
    const file = 'events.json';
    const path = `/${index}`;
    const stages = event.stages ?? [];
    const stageIds = new Set(stages.map((stage) => stage.id));
    this.unique(stages, file, `${path}/stages`);
    this.condition(event.condition, file, `${path}/condition`);
    const entries: Outcome[] = [];
    if (event.interaction === 'choice') {
      this.unique(event.options, file, `${path}/options`);
      event.options.forEach((option, optionIndex) => {
        this.condition(option.condition, file, `${path}/options/${optionIndex}/condition`);
        this.outcome(option.outcome, file, `${path}/options/${optionIndex}/outcome`, stageIds);
        entries.push(option.outcome);
      });
    } else {
      this.outcome(event.outcome, file, `${path}/outcome`, stageIds);
      entries.push(event.outcome);
    }
    stages.forEach((stage, stageIndex) => {
      this.outcome(stage.success, file, `${path}/stages/${stageIndex}/success`, stageIds);
      this.outcome(stage.failure, file, `${path}/stages/${stageIndex}/failure`, stageIds);
    });
    if (event.trigger.kind === 'historical' && (event.trigger.year < this.content.era.start_year || event.trigger.year > this.content.era.historical_end_year)) {
      this.issue(file, `${path}/trigger/year`, 'INVALID_COMBINATION', '历史事件年份必须在历史窗口内。');
    }
    const indices = new Map(stages.map((stage, stageIndex) => [stage.id, stageIndex]));
    const adjacency = stages.map((stage) => [stage.success.next_stage_id, stage.failure.next_stage_id]
      .flatMap((id) => id === null || !indices.has(id) ? [] : [indices.get(id)!]));
    const reachable = new Set<number>();
    const pending = entries.flatMap((outcome) => outcome.next_stage_id === null || !indices.has(outcome.next_stage_id) ? [] : [indices.get(outcome.next_stage_id)!]);
    while (pending.length > 0) {
      const stageIndex = pending.pop()!;
      if (reachable.has(stageIndex)) continue;
      reachable.add(stageIndex);
      pending.push(...adjacency[stageIndex]!);
    }
    stages.forEach((_stage, stageIndex) => {
      if (!reachable.has(stageIndex)) this.issue(file, `${path}/stages/${stageIndex}`, 'INVALID_GRAPH', '阶段无法从事件入口到达。');
    });
    // Remove terminal leaves backwards; anything left is a cycle or can lead into one.
    const outgoing = adjacency.map((edges) => edges.length);
    const predecessors: number[][] = stages.map(() => []);
    adjacency.forEach((edges, from) => edges.forEach((to) => predecessors[to]!.push(from)));
    const terminals = outgoing.flatMap((count, stageIndex) => count === 0 ? [stageIndex] : []);
    while (terminals.length > 0) {
      for (const previous of predecessors[terminals.pop()!]!) {
        outgoing[previous] = outgoing[previous]! - 1;
        if (outgoing[previous] === 0) terminals.push(previous);
      }
    }
    outgoing.forEach((count, stageIndex) => {
      if (count > 0) this.issue(file, `${path}/stages/${stageIndex}`, 'INVALID_GRAPH', '阶段图包含循环或不能保证最终结束。');
    });
  }

  private rules(): void {
    const { rules, era } = this.content;
    const { min, max, base } = rules.attributes;
    if (min >= max || base < min || base > max || !Number.isFinite(max - min)) this.issue('rules.json', '/attributes', 'INVALID_COMBINATION', '属性范围必须 min < max，base 在范围内且跨度有限。');
    if (rules.check.modifier_min > rules.check.modifier_max) this.issue('rules.json', '/check', 'INVALID_COMBINATION', '检定修正下界不能大于上界。');
    if (rules.luck.factor_min > rules.luck.factor_max) this.issue('rules.json', '/luck', 'INVALID_COMBINATION', '运气因子下界不能大于上界。');
    this.reference('pools', rules.opening.pool_id, 'rules.json', '/opening/pool_id');
    if (rules.opening.year_min > rules.opening.year_max) this.issue('rules.json', '/opening', 'INVALID_COMBINATION', '开局年份下界不能大于上界。');
    this.uniform(rules.opening.year_min, rules.opening.year_max, 'rules.json', '/opening');
    if (rules.opening.year_min < era.start_year || rules.opening.year_max > era.historical_end_year) this.issue('rules.json', '/opening', 'INVALID_COMBINATION', '开局年份必须在历史窗口内。');
    if (rules.lifespan.min > rules.lifespan.max) this.issue('rules.json', '/lifespan', 'INVALID_COMBINATION', '寿命下界不能大于上界。');
    if (era.start_year > era.historical_end_year) this.issue('era.json', '/historical_end_year', 'INVALID_COMBINATION', '历史窗口结束年份不能早于起始年份。');
    this.unique(rules.age_bands, 'rules.json', '/age_bands');
    this.distribution(rules.age_bands.map((band) => band.weight), 'rules.json', '/age_bands');
    rules.age_bands.forEach((band, index) => {
      if (band.min > band.max) this.issue('rules.json', `/age_bands/${index}`, 'INVALID_COMBINATION', '年龄段下界不能大于上界。');
      this.uniform(band.min, band.max, 'rules.json', `/age_bands/${index}`);
      if (rules.age_bands.slice(0, index).some((other) => band.min <= other.max && other.min <= band.max)) this.issue('rules.json', `/age_bands/${index}`, 'INVALID_COMBINATION', '年龄段不能重叠。');
    });
    this.distribution(this.content.regions.map((region) => region.weight), 'regions.json', '');
    this.distribution(this.content.castes.map((caste) => caste.weight), 'castes.json', '');
    for (const kind of ['opening', 'random'] as const) {
      const weights = this.content.events.flatMap((event) => {
        if (event.trigger.kind !== kind) return [];
        return [event.trigger.weight * (event.trigger.kind === 'random' && event.trigger.rare ? rules.luck.factor_max : 1)];
      });
      this.distribution(weights, 'events.json', '', false);
    }
  }

  private starts(): void {
    if (!this.backgroundConditionsValid) return;
    const { rules, era, regions, castes } = this.content;
    // Non-starting fields are unreachable: condition validation above rejects them.
    const context: ConditionContext = {
      age: 0, calendar_year: era.start_year, region_id: '', caste_id: '', identity_id: '', timeline: 'historical',
      physique: 0, intelligence: 0, wealth: 0, prestige: 0, luck: 0,
      cards: [], flags: [], injuries: [], completed_chains: [], active_chains: [],
    };
    const breakpoints = new Set<number>();
    era.backgrounds.forEach((background) => ageBreakpoints(background.condition, breakpoints));
    for (const band of rules.age_bands) {
      if (band.min > band.max) continue;
      // A compare predicate can change only around one of these integer boundaries.
      const ages = new Set([band.min, band.max, ...[...breakpoints].filter((age) => age >= band.min && age <= band.max)]);
      for (const age of ages) {
        context.age = age;
        const requiredLifespan = age + rules.lifespan.min_remaining_years;
        const low = Math.max(rules.lifespan.min, requiredLifespan);
        if (!Number.isSafeInteger(requiredLifespan) || low > rules.lifespan.max) {
          this.issue('rules.json', '/lifespan', 'INVALID_DISTRIBUTION', `起始年龄 ${age} 没有满足剩余年数的合法寿命。`);
        } else {
          this.uniform(low, rules.lifespan.max, 'rules.json', '/lifespan');
          if (!Number.isSafeInteger(rules.opening.year_max + (rules.lifespan.max - age))) this.issue('rules.json', '/opening/year_max', 'INVALID_COMBINATION', '可达公历年份超出安全整数范围。');
        }
        let pairTotal = 0;
        for (const region of regions) {
          if (region.weight <= 0) continue;
          context.region_id = region.id;
          for (const caste of castes) {
            if (caste.weight <= 0) continue;
            context.caste_id = caste.id;
            const backgrounds = era.backgrounds.filter((background) => background.weight > 0 && evaluateCondition(background.condition, context));
            if (backgrounds.length === 0) continue;
            this.distribution(backgrounds.map((background) => background.weight), 'era.json', '/backgrounds');
            pairTotal += region.weight * caste.weight;
            for (const background of backgrounds) attributes.forEach((attribute) => {
              const base = rules.attributes.base + (band.modifiers[attribute] ?? 0) + (caste.modifiers[attribute] ?? 0)
                + (region.modifiers[attribute] ?? 0) + (background.modifiers[attribute] ?? 0);
              if (!Number.isFinite(base)) {
                this.issue('rules.json', '/attributes', 'INVALID_COMBINATION', '合法开局的属性总修正会产生非有限数值。');
              }
            });
          }
        }
        if (!Number.isFinite(pairTotal) || pairTotal <= 0) this.issue('era.json', '/backgrounds', 'INVALID_DISTRIBUTION', `起始年龄 ${age} 没有有限正权重的合法地区、门第和生平组合。`);
      }
    }
  }

  validate(): ValidationResult {
    const content = this.content;
    for (const key of ['regions', 'castes', 'cards', 'pools', 'events', 'chains', 'achievements', 'deaths'] as const) this.unique(content[key], `${key}.json`, '');
    for (const key of ['backgrounds', 'identities', 'injuries'] as const) this.unique(content.era[key], 'era.json', `/${key}`);
    this.reference('deaths', content.era.old_age_death_id, 'era.json', '/old_age_death_id');
    content.era.backgrounds.forEach((background, index) => {
      this.reference('identities', background.identity_id, 'era.json', `/backgrounds/${index}/identity_id`);
      this.condition(background.condition, 'era.json', `/backgrounds/${index}/condition`, true);
    });
    const transitions = content.era.age_transitions ?? [];
    this.unique(transitions, 'era.json', '/age_transitions');
    transitions.forEach((transition, index) => {
      const path = `/age_transitions/${index}`;
      this.condition(transition.condition, 'era.json', `${path}/condition`);
      this.effects(transition.effects, 'era.json', `${path}/effects`);
    });
    content.era.injuries.forEach((injury, index) => {
      this.effects(injury.annual_effects, 'era.json', `/injuries/${index}/annual_effects`);
      if (injury.annual_effects.some((effect) => effect.type === 'death')
        && injury.annual_effects.some((effect) => effect.type === 'attribute_add' && effect.amount > 0)) {
        this.issue('era.json', `/injuries/${index}/annual_effects`, 'INVALID_COMBINATION', '包含死亡的年度效果不能同时奖励正属性。');
      }
    });
    content.pools.forEach((pool, index) => {
      const path = `/${index}`;
      const seen = new Set<string>();
      pool.entries.forEach((entry, entryIndex) => {
        this.reference('cards', entry.card_id, 'pools.json', `${path}/entries/${entryIndex}/card_id`);
        if (seen.has(entry.card_id)) this.issue('pools.json', `${path}/entries/${entryIndex}/card_id`, 'DUPLICATE_ID', '同一卡池不能重复列出卡牌。');
        seen.add(entry.card_id);
      });
      this.distribution(pool.entries.map((entry) => entry.weight), 'pools.json', `${path}/entries`);
      if (pool.hard_pity) {
        if (!pool.replacement) this.issue('pools.json', `${path}/hard_pity`, 'INVALID_COMBINATION', '硬保底只允许用于有放回卡池。');
        pool.hard_pity.target_card_ids.forEach((id, targetIndex) => {
          if (!seen.has(id)) this.issue('pools.json', `${path}/hard_pity/target_card_ids/${targetIndex}`, 'MISSING_REFERENCE', `保底目标不在本卡池中：${id}。`);
        });
        const targetIds = new Set(pool.hard_pity.target_card_ids);
        this.distribution(pool.entries.filter((entry) => targetIds.has(entry.card_id)).map((entry) => entry.weight), 'pools.json', `${path}/hard_pity/target_card_ids`);
      }
    });
    content.events.forEach((event, index) => this.event(event, index));
    content.chains.forEach((chain, index) => {
      const path = `/${index}`;
      this.condition(chain.interrupt_condition, 'chains.json', `${path}/interrupt_condition`);
      let previous = 0;
      chain.nodes.forEach((node, nodeIndex) => {
        const nodePath = `${path}/nodes/${nodeIndex}`;
        if (node.after_years <= previous) this.issue('chains.json', `${nodePath}/after_years`, 'INVALID_COMBINATION', '任务节点年份偏移必须严格递增。');
        previous = node.after_years;
        this.reference('events', node.event_id, 'chains.json', `${nodePath}/event_id`);
        const event = this.eventById.get(node.event_id);
        if (event && event.trigger.kind !== 'chain') this.issue('chains.json', `${nodePath}/event_id`, 'INVALID_COMBINATION', '任务节点必须引用 kind=chain 的事件。');
        if (!Number.isSafeInteger(content.era.start_year + node.after_years)) this.issue('chains.json', `${nodePath}/after_years`, 'INVALID_COMBINATION', '任务到期年份超出安全整数范围。');
      });
      this.outcome(chain.completion, 'chains.json', `${path}/completion`, undefined, true);
    });
    content.achievements.forEach((achievement, index) => this.condition(achievement.condition, 'achievements.json', `/${index}/condition`));
    this.rules();
    this.starts();
    return { ok: this.issues.length === 0, issues: this.issues };
  }
}

/** Unknown callers receive issues, never a partial bundle or an unchecked cast. */
export function validateContent(value: unknown): ValidationResult {
  const issues = validateStructure(value);
  if (issues.length > 0) return { ok: false, issues };
  return new SemanticValidator(value as ContentBundle).validate();
}
