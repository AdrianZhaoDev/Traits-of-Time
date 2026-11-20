import type { RecordStorage } from './LifetimeRecords';
import type { CatalogKind } from './CollectionCatalog';

export interface CollectionGoal {
  kind: CatalogKind;
  id: string;
}

const KEY = 'time-travel.collection-goal.v1';

function isGoal(value: unknown): value is CollectionGoal {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('id' in value)) return false;
  return (value.kind === 'achievements' || value.kind === 'deaths')
    && typeof value.id === 'string' && value.id.length > 0;
}

/** A preference, independent of life saves and lifetime records. */
export class CollectionGoalStore {
  goal: CollectionGoal | null = null;
  warning = '';

  constructor(private readonly storage: RecordStorage | undefined) {
    try {
      const raw = storage?.getItem(KEY);
      if (raw == null) return;
      const saved: unknown = JSON.parse(raw);
      if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 || !('goal' in saved)) {
        throw new Error('Invalid collection goal');
      }
      const goal = saved.goal;
      if (goal !== null && !isGoal(goal)) throw new Error('Invalid collection goal');
      this.goal = goal && { kind: goal.kind, id: goal.id };
    } catch {
      this.warning = '收集目标暂时无法读取，不影响人生存档和图鉴记录。';
    }
  }

  set(goal: CollectionGoal | null, writable: boolean): boolean {
    if (!writable) {
      this.warning = '当前为只读模式，不能修改收集目标。';
      return false;
    }
    if (!this.storage || (goal !== null && !isGoal(goal))) {
      this.warning = '收集目标未能保存，不影响人生存档和图鉴记录。';
      return false;
    }
    const value = JSON.stringify({ version: 1, goal });
    try {
      this.storage.setItem(KEY, value);
      if (this.storage.getItem(KEY) !== value) throw new Error('Collection goal write not confirmed');
      this.goal = goal && { kind: goal.kind, id: goal.id };
      this.warning = '';
      return true;
    } catch {
      this.warning = '收集目标未能确认保存，不影响人生存档和图鉴记录。';
      return false;
    }
  }
}
