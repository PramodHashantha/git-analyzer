import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ActivityBucket } from '../../lib/types'

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c']

export function ActivityOverTimeChart({ activity }: { activity: ActivityBucket[] }) {
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
      <h2 className="mb-4 text-lg font-semibold">Activity over time</h2>
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
