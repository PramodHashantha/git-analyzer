import type { BusFactorEntry } from '../../../shared/types'

export function BusFactorTable({ busFactor }: { busFactor: BusFactorEntry[] }) {
  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Bus factor risk</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">File</th>
            <th className="p-2">Total lines</th>
            <th className="p-2">Top author</th>
            <th className="p-2">% owned</th>
          </tr>
        </thead>
        <tbody>
          {busFactor.map((f) => (
            <tr key={f.filepath} className="border-t">
              <td className="p-2">{f.filepath}</td>
              <td className="p-2">{f.totalLines}</td>
              <td className="p-2">{f.topAuthor}</td>
              <td className="p-2">{f.topAuthorPercentage.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
