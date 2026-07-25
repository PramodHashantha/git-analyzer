import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ActivityBucket } from '../../../shared/types'
import type { BucketGranularity } from '../../../shared/aggregate-churn'

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c']

export function ActivityOverTimeChart({
  activity,
  granularity,
  onGranularityChange,
}: {
  activity: ActivityBucket[]
  granularity: BucketGranularity
  onGranularityChange: (granularity: BucketGranularity) => void
}) {
  const { rows, authors } = useMemo(() => {
    const byBucket = new Map<number, Record<string, number>>()
    const authorSet = new Set<string>()

    for (const entry of activity) {
      authorSet.add(entry.author)
      const row = byBucket.get(entry.bucketStart) ?? { bucketStart: entry.bucketStart }
      row[entry.author] = entry.added
      byBucket.set(entry.bucketStart, row)
    }

    return {
      rows: [...byBucket.values()].sort((a, b) => a.bucketStart - b.bucketStart),
      authors: [...authorSet],
    }
  }, [activity])

  return (
    <section className="rounded bg-white p-4 shadow">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Activity over time</h2>
        <div className="flex gap-1 text-sm">
          <button
            type="button"
            onClick={() => onGranularityChange('week')}
            className={`rounded px-2 py-1 ${granularity === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => onGranularityChange('month')}
            className={`rounded px-2 py-1 ${granularity === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Month
          </button>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <XAxis
              dataKey="bucketStart"
              tickFormatter={(value) => new Date(value).toLocaleDateString()}
            />
            <YAxis />
            <Tooltip labelFormatter={(value) => new Date(value).toLocaleDateString()} />
            <Legend />
            {authors.map((author, i) => (
              <Line
                key={author}
                type="monotone"
                dataKey={author}
                stroke={COLORS[i % COLORS.length]}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
