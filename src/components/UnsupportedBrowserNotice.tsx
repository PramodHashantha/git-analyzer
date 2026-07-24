export function UnsupportedBrowserNotice() {
  return (
    <div className="rounded border border-amber-400 bg-amber-50 p-4 text-amber-900">
      <p className="font-semibold">Unsupported browser</p>
      <p>
        This app reads git repos directly from your machine using the File System Access
        API, which is only available in Chromium-based browsers (Chrome, Edge). Please open
        this page in one of those browsers to continue.
      </p>
    </div>
  )
}
