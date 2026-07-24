export function BranchSelector({
  branches,
  selected,
  onChange,
}: {
  branches: string[]
  selected: string
  onChange: (branch: string) => void
}) {
  return (
    <label className="text-sm">
      Branch:{' '}
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border p-1"
      >
        {branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
    </label>
  )
}
