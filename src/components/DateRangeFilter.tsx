import type { DateRange } from '../lib/filters'

export function DateRangeFilter({
  range,
  onChange,
}: {
  range: DateRange
  onChange: (range: DateRange) => void
}) {
  const toInputValue = (ms: number | null) =>
    ms === null ? '' : new Date(ms).toISOString().slice(0, 10)
  const fromInputValue = (value: string) => (value === '' ? null : new Date(value).getTime())

  return (
    <div className="flex items-center gap-2 text-sm">
      <label>
        From:{' '}
        <input
          type="date"
          value={toInputValue(range.start)}
          onChange={(e) => onChange({ ...range, start: fromInputValue(e.target.value) })}
          className="rounded border p-1"
        />
      </label>
      <label>
        To:{' '}
        <input
          type="date"
          value={toInputValue(range.end)}
          onChange={(e) => onChange({ ...range, end: fromInputValue(e.target.value) })}
          className="rounded border p-1"
        />
      </label>
    </div>
  )
}
