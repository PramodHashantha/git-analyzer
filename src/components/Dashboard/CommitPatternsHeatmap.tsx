import type { CommitPatternSummary } from '../../../shared/types'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CommitPatternsHeatmap({ patterns }: { patterns: CommitPatternSummary[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Commit patterns</h2>
      {patterns.map((pattern) => {
        const maxDay = Math.max(...pattern.dayOfWeekCounts, 1)
        const maxHour = Math.max(...pattern.hourOfDayCounts, 1)
        return (
          <div key={pattern.author} className="mb-6">
            <p className="mb-1 text-sm font-medium">
              {pattern.author} · avg {pattern.avgLinesPerCommit.toFixed(1)} lines/commit · largest commit:{' '}
              {pattern.largestCommit.lines} lines ({pattern.largestCommit.oid.slice(0, 7)})
            </p>
            <div className="mb-2 flex gap-1">
              {pattern.dayOfWeekCounts.map((count, i) => (
                <div
                  key={DAY_LABELS[i]}
                  title={`${DAY_LABELS[i]}: ${count} commits`}
                  className="flex h-8 w-8 items-center justify-center rounded text-[10px] text-white"
                  style={{ backgroundColor: `rgba(37, 99, 235, ${0.15 + 0.85 * (count / maxDay)})` }}
                >
                  {DAY_LABELS[i]}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {pattern.hourOfDayCounts.map((count, i) => (
                <div
                  key={i}
                  title={`${i}:00 — ${count} commits`}
                  className="flex h-6 w-6 items-center justify-center rounded text-[9px] text-white"
                  style={{ backgroundColor: `rgba(22, 163, 74, ${0.15 + 0.85 * (count / maxHour)})` }}
                >
                  {i}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
