import { afterEach, describe, expect, it, vi } from 'vitest';
import { Node } from '../mocks/cc-mock';
import { EventFoldItem } from '../../assets/scripts/presentation/EventFoldItem';
import { GameAudio } from '../../assets/scripts/presentation/GameAudio';
import { LogParser } from '../../assets/scripts/presentation/LogParser';

const originalAudio = GameAudio.instance;
afterEach(() => { GameAudio.instance = originalAudio; vi.restoreAllMocks(); });

describe('achievement presentation', () => {
  it('celebrates each live achievement once, stays quiet at death, and resets for a new life', () => {
    const playCue = vi.fn();
    GameAudio.instance = { playCue } as unknown as GameAudio;
    const log = new Node('LifeLog');
    const first = new Node('First');
    const redraw = new Node('Redraw');
    log.addChild(first);
    log.addChild(redraw);
    const a = first.addComponent(EventFoldItem);
    const b = redraw.addComponent(EventFoldItem);
    const [achievement, terminalAchievement] = LogParser.parseBatch([
      { type: 'achievement', seq: 42, source_id: 'A_CAREER_WORKSHOP', message: '工坊经历' },
      { type: 'achievement', seq: 43, source_id: 'A_LONG_LIFE', message: '人生走到终点' },
    ]);

    a.init(achievement!);
    b.init(achievement!);
    expect(playCue.mock.calls.filter(([name]) => name === 'achievement')).toHaveLength(1);

    a.init(terminalAchievement!, false);
    b.init(terminalAchievement!);
    expect(playCue.mock.calls.filter(([name]) => name === 'achievement')).toHaveLength(1);

    EventFoldItem.resetAchievementFeedback(log);
    a.init(achievement!);
    expect(playCue.mock.calls.filter(([name]) => name === 'achievement')).toHaveLength(2);
  });
});
