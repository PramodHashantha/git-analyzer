import type { HotspotEntry } from '../../../shared/types'

export function HotspotsTable({ hotspots }: { hotspots: HotspotEntry[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Hotspots</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">File</th>
            <th className="p-2">Total churn</th>
            <th className="p-2">Authors</th>
            <th className="p-2">Score</th>
          </tr>
        </thead>
        <tbody>
          {hotspots.map((h) => (
            <tr key={h.filepath} className="border-t">
              <td className="p-2">{h.filepath}</td>
              <td className="p-2">{h.totalChurn}</td>
              <td className="p-2">{h.authorCount}</td>
              <td className="p-2">{h.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
