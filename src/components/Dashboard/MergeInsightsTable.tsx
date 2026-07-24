import type { BranchMergeInsights } from '../../lib/types'

export function MergeInsightsTable({ mergeInsights }: { mergeInsights: BranchMergeInsights[] }) {
  if (mergeInsights.length === 0) return null

  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Merge commits</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Author</th>
            <th className="p-2">Merge commits</th>
          </tr>
        </thead>
        <tbody>
          {mergeInsights.map((row) => (
            <tr key={row.author} className="border-t">
              <td className="p-2">{row.author}</td>
              <td className="p-2">{row.mergeCommits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
