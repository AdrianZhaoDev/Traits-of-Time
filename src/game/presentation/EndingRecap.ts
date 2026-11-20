import type { ContentBundle } from '../core/types/content.generated';
import type { EndingReport, LogEntry, PlayerState } from '../core/types/schema';

const MISSING_EXPERIENCE = '这段经历没有可展示的记录';

type EventLog = Extract<LogEntry, { type: 'event' | 'option' | 'dice' }>;

interface Story {
  seq: number;
  age: number;
  year: number;
  sourceId: string;
  parts: string[];
  hasOption: boolean;
  hasCheck: boolean;
  hasOutcome: boolean;
}

interface Candidate {
  seq: number;
  age: number;
  year: number;
  priority: number;
  text: string;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[。！？!?；;…][”’」』》）)]?$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function recordedLogs(report: EndingReport, logs: readonly LogEntry[]): LogEntry[] {
  // key_decisions is already a subset of the engine's actual logs, not a
  // reconstruction of the selected options' possible outcomes.
  const bySequence = new Map<number, LogEntry>();
  for (const log of report.key_decisions) {
    if (log.type === 'option' || log.type === 'dice') bySequence.set(log.seq, log);
  }
  for (const log of logs) bySequence.set(log.seq, log);
  return [...bySequence.values()].sort((a, b) => a.seq - b.seq);
}

function openingText(bundle: ContentBundle, report: EndingReport, player: PlayerState | null, logs: readonly LogEntry[]): string {
  const parts = [`${report.start_year}年，${report.start_age}岁开始这段人生。`];
  const opening = logs.find(log => log.type === 'opening' && log.age === report.start_age && log.calendar_year === report.start_year);
  if (opening?.type === 'opening') {
    const background = bundle.era.backgrounds.find(item => item.id === opening.data.background_id);
    const identity = background && bundle.era.identities.find(item => item.id === background.identity_id);
    if (identity?.name.trim()) parts.push(sentence(`开局身份：${identity.name}`));
    const backgroundText = sentence(opening.message);
    if (backgroundText) parts.push(backgroundText);
  }

  const selected = logs.find(log => log.type === 'card_selected' && log.age === report.start_age && log.calendar_year === report.start_year);
  // The current player is authoritative about carried cards. If it is absent,
  // an opening/selection log still proves which card was selected at the start.
  const cardIds = player !== null
    ? player.cards
    : selected?.type === 'card_selected' ? [selected.data.card_id]
      : opening?.type === 'opening' ? [opening.data.card_id] : [];
  if (cardIds.length) {
    const names = cardIds.map(id => {
      const selection = logs.find(log => log.type === 'card_selected' && log.data.card_id === id);
      return selection?.message.trim() || bundle.cards.find(card => card.id === id)?.name.trim() || '名称暂不可用';
    });
    parts.push(sentence(`${player === null ? '开局所选家当' : '携带家当'}：${names.join('、')}`));
  } else {
    parts.push('没有可确认的家当记录。');
  }
  return parts.join(' ');
}

function chainCandidate(bundle: ContentBundle, log: Extract<LogEntry, { type: 'chain' }>): Candidate {
  const definition = bundle.chains.find(chain => chain.id === log.data.chain_id);
  // For interrupted chains the message is the interruption reason, not a name.
  const name = definition?.name.trim() || (log.data.action === 'interrupted' ? '' : log.message.trim());
  const subject = name ? `「${name}」` : '一项经历';
  const action = log.data.action === 'started' ? '开始' : log.data.action === 'completed' ? '完成' : '中断';
  const reason = log.data.action === 'interrupted' ? log.data.reason?.trim() : '';
  const detail = reason && !/^[A-Z][A-Z0-9_]*$/.test(reason) ? ` ${sentence(reason)}` : '';
  return {
    seq: log.seq, age: log.age, year: log.calendar_year,
    priority: log.data.action === 'started' ? 3 : 4,
    text: `${subject}${action}。${detail}`,
  };
}

function storyPriority(story: Story): number {
  if (story.hasOption && story.hasCheck) return 6;
  if (story.hasOption && story.hasOutcome) return 5;
  if (story.hasCheck && story.hasOutcome) return 4;
  if (story.hasOption || story.hasCheck) return 3;
  return story.hasOutcome ? 2 : 1;
}

function experienceText(bundle: ContentBundle, logs: readonly LogEntry[]): string {
  const instances = new Map<string, Story>();
  const stories: Story[] = [];
  const candidates: Candidate[] = [];
  let active: Story | null = null;
  let previousSeq: number | null = null;
  let previousType: LogEntry['type'] | null = null;

  const storyFor = (log: EventLog): Story => {
    const key = log.data.event_instance_id;
    let story = instances.get(key);
    if (story && (story.sourceId !== log.source_id || story.year !== log.calendar_year || story.age !== log.age)) story = undefined;
    if (!story) {
      story = { seq: log.seq, age: log.age, year: log.calendar_year, sourceId: log.source_id, parts: [], hasOption: false, hasCheck: false, hasOutcome: false };
      instances.set(key, story);
      stories.push(story);
    }
    return story;
  };

  for (const log of logs) {
    // The engine emits an event/option/dice and its outcome consecutively.
    // A matching source after an intervening record cannot prove provenance.
    const followsEvent = previousType === 'event' || previousType === 'option' || previousType === 'dice';
    if (previousSeq !== null && log.seq !== previousSeq + 1) active = null;
    if (active && (log.calendar_year !== active.year || log.age !== active.age)) active = null;
    previousSeq = log.seq;
    previousType = log.type;

    if (log.type === 'event' || log.type === 'option' || log.type === 'dice') {
      active = storyFor(log);
      const text = log.message.trim();
      if (log.type === 'event' && text) active.parts.push(sentence(text));
      if (log.type === 'option' && text) {
        active.hasOption = true;
        active.parts.push(sentence(`选择：${text}`));
      }
      if (log.type === 'dice') {
        active.hasCheck = true;
        active.parts.push(sentence(`${log.data.success ? '检定通过' : '检定未通过'}${text ? `：${text}` : ''}`));
      }
    } else if (log.type === 'effects') {
      const text = sentence(log.message);
      if (active && followsEvent && active.sourceId === log.source_id) {
        if (text) {
          active.hasOutcome = true;
          active.parts.push(sentence(`结果：${log.message.trim()}`));
        }
      } else {
        active = null;
        if (text) candidates.push({ seq: log.seq, age: log.age, year: log.calendar_year, priority: 2, text });
      }
    } else if (log.type === 'chain') {
      candidates.push(chainCandidate(bundle, log));
    } else if (log.type !== 'achievement') {
      // Achievements and chain notifications may occur inside an outcome; all
      // other log kinds are boundaries rather than evidence of its result.
      active = null;
    }
  }

  for (const story of stories) {
    if (story.parts.length) candidates.push({
      seq: story.seq, age: story.age, year: story.year,
      priority: storyPriority(story), text: story.parts.join(' '),
    });
  }
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (!best || candidate.priority > best.priority || (candidate.priority === best.priority && candidate.seq < best.seq)) best = candidate;
  }
  return best ? `${best.year}年，${best.age}岁：${best.text}` : MISSING_EXPERIENCE;
}

function endingText(bundle: ContentBundle, report: EndingReport, logs: readonly LogEntry[]): string {
  const parts = [`${report.end_year}年，${report.end_age}岁离世。`];
  const death = bundle.deaths.find(item => item.id === report.death_id);
  const deathLog = logs.find(log => log.type === 'death' && log.data.death_id === report.death_id);
  parts.push(sentence(`死因：${death?.name.trim() || '名称暂不可用'}`));
  if (deathLog?.message.trim()) parts.push(sentence(deathLog.message));

  // Life-category primary achievements are evaluated at the end and are not
  // necessarily present in player.achievements or achievement log entries.
  const ids = new Set<string>();
  if (report.primary_achievement_id) ids.add(report.primary_achievement_id);
  for (const id of report.milestone_achievement_ids) ids.add(id);
  for (const id of report.anecdote_achievement_ids) ids.add(id);
  for (const id of report.achievements) ids.add(id);
  const names: string[] = [];
  let unknown = 0;
  for (const id of ids) {
    const name = bundle.achievements.find(item => item.id === id)?.name.trim();
    if (name) names.push(name);
    else unknown++;
  }
  if (unknown) names.push(`名称暂不可用（${unknown}项）`);
  parts.push(names.length ? sentence(`获得的成就：${names.join('、')}`) : '暂无成就记录。');
  return parts.join(' ');
}

/**
 * Present one life using its matching content bundle, ending report, player and
 * engine logs. Pass null/[] for unavailable state or logs. The report's own
 * key_decisions are recorded option/dice logs; neither they nor an archived
 * lifetime summary supply missing outcome narratives. No input is mutated.
 */
export function buildEndingRecap(
  bundle: ContentBundle,
  report: EndingReport,
  player: PlayerState | null,
  logs: readonly LogEntry[],
): { start: string; experience: string; ending: string } {
  const recorded = recordedLogs(report, logs);
  return {
    start: openingText(bundle, report, player, recorded),
    experience: experienceText(bundle, recorded),
    ending: endingText(bundle, report, recorded),
  };
}
