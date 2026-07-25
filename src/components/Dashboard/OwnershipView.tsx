import { useState } from 'react'
import type { AuthorOwnership, FileOwnership } from '../../lib/types'
import { rollupByDirectory } from '../../lib/directory-rollup'

export function OwnershipView({
  authorOwnership,
  fileOwnership,
}: {
  authorOwnership: AuthorOwnership[]
  fileOwnership: FileOwnership[]
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const selected = fileOwnership.find((f) => f.filepath === selectedFile) ?? null
  const directories = rollupByDirectory(fileOwnership)

  return (
    <section className="rounded bg-white p-4 shadow">
      <h2 className="mb-4 text-lg font-semibold">Current line ownership (HEAD)</h2>

      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Author</th>
            <th className="p-2">Lines owned</th>
            <th className="p-2">% of codebase</th>
          </tr>
        </thead>
        <tbody>
          {authorOwnership.map((row) => (
            <tr key={row.author} className="border-t">
              <td className="p-2">{row.author}</td>
              <td className="p-2">{row.linesOwned}</td>
              <td className="p-2">{row.percentage.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mb-2 text-sm font-semibold">Directories</h3>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Directory</th>
            <th className="p-2">Lines</th>
          </tr>
        </thead>
        <tbody>
          {directories.map((dir) => (
            <tr key={dir.filepath} className="border-t">
              <td className="p-2">{dir.filepath}</td>
              <td className="p-2">{dir.totalLines}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mb-2 text-sm font-semibold">Files (click to see owners)</h3>

      {selected && (
        <div data-testid="file-owner-detail" className="mb-4 rounded border p-3">
          <p className="mb-2 font-medium">{selected.filepath}</p>
          <ul className="text-sm">
            {Object.entries(selected.ownerLineCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([author, count]) => (
                <li key={author}>
                  {author}: {count} lines
                </li>
              ))}
          </ul>
        </div>
      )}

      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">File</th>
            <th className="p-2">Lines</th>
          </tr>
        </thead>
        <tbody>
          {fileOwnership
            .slice()
            .sort((a, b) => b.totalLines - a.totalLines)
            .map((file) => (
              <tr
                key={file.filepath}
                className="cursor-pointer border-t hover:bg-gray-50"
                onClick={() => setSelectedFile(file.filepath)}
              >
                <td className="p-2">{file.filepath}</td>
                <td className="p-2">{file.totalLines}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  )
}
