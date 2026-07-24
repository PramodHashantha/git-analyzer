import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AuthorTotals } from '../../lib/types'

export function OverviewTable({ authorTotals }: { authorTotals: AuthorTotals[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Contribution overview</h2>
      <div className="mb-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={authorTotals}>
            <XAxis dataKey="author" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="added" fill="#16a34a" />
            <Bar dataKey="deleted" fill="#dc2626" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Author</th>
            <th className="p-2">Commits</th>
            <th className="p-2">Added</th>
            <th className="p-2">Deleted</th>
            <th className="p-2">Net</th>
          </tr>
        </thead>
        <tbody>
          {authorTotals.map((row) => (
            <tr key={row.author} className="border-t">
              <td className="p-2">{row.author}</td>
              <td className="p-2">{row.commits}</td>
              <td className="p-2">{row.added}</td>
              <td className="p-2">{row.deleted}</td>
              <td className="p-2">{row.net}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
