import type { LifeReport } from './simulate';

/** Observational telemetry only: a scheduled event or a bookkeeping flag is not progress. */
export function lateLifeTelemetry(life: LifeReport) {
  const start = life.start_year + 9;
  const commands = life.evidence.commands.filter(command => command.year >= start);
  const logs = commands.flatMap(command => command.logs);
  const transitions = logs.filter(log => String(log.type) === 'late_life');
  const windows = logs.filter(log => String(log.type) === 'follow_up');
  const events = logs.filter(log => log.type === 'event').map(log => ({ year: log.calendar_year, event_id: log.source_id, ...log.data }));
  const frequencies: Record<string, number> = {};
  for (const event of events) frequencies[event.event_id] = (frequencies[event.event_id] ?? 0) + 1;
  const rows: ({ year: number } & Record<string, unknown>)[] = windows.map(log => ({ year: log.calendar_year, ...(log.data as unknown as Record<string, unknown>) }));
  const statuses: Record<string, number> = {};
  for (const row of rows) {
    const status = String(row.status);
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return {
    transitions, windows: rows, window_statuses: statuses, events,
    overdue_windows: rows.filter(row => row.year > Number(row.latest_year)),
    repeated_events: Object.entries(frequencies).filter(([, count]) => count > 1).map(([event_id, count]) => ({ event_id, count })),
    unavailable_windows: rows.filter(row => row.status === 'no_candidate' || row.status === 'overdue'),
    material_exhaustion: rows.filter(row => {
      const candidates = row.candidates as { reason: string | null }[] | undefined;
      return candidates?.length && candidates.every(candidate => candidate.reason === 'MAX_OCCURRENCES');
    }),
  };
}
