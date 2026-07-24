export function AuthorFilter({
  allAuthors,
  selected,
  onChange,
}: {
  allAuthors: string[]
  selected: string[]
  onChange: (authors: string[]) => void
}) {
  const toggle = (author: string) => {
    onChange(
      selected.includes(author) ? selected.filter((a) => a !== author) : [...selected, author]
    )
  }

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {allAuthors.map((author) => (
        <button
          key={author}
          type="button"
          onClick={() => toggle(author)}
          className={`rounded-full border px-3 py-1 ${
            selected.includes(author) ? 'bg-blue-600 text-white' : 'bg-white'
          }`}
        >
          {author}
        </button>
      ))}
    </div>
  )
}
