import { useState, useEffect } from 'react'

export default function HistoryPage() {
  const [history, setHistory] = useState([])
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetch('/api/history').then(r => r.json()).then(setHistory).catch(() => {})
  }, [])

  function handleDelete(id) {
    fetch(`/api/history/${id}`, { method: 'DELETE' })
      .then(() => {
        setHistory(h => h.filter(item => item.id !== id))
        if (selected?.id === id) setSelected(null)
      })
      .catch(() => {})
  }

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-xl font-semibold text-white mb-6">Video History</h2>

      {history.length === 0 ? (
        <p className="text-gray-500 text-sm">No videos generated yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {history.map(item => (
            <div
              key={item.id}
              className={`bg-gray-900 border rounded-lg overflow-hidden cursor-pointer transition-all hover:border-indigo-500 ${
                selected?.id === item.id ? 'border-indigo-500 ring-2 ring-indigo-500/50' : 'border-gray-700'
              }`}
              onClick={() => setSelected(item)}
            >
              {item.thumbnail ? (
                <img src={`/thumbnails/${item.thumbnail}`} alt="" className="w-full aspect-video object-cover" />
              ) : (
                <div className="w-full aspect-video bg-gray-800 flex items-center justify-center text-gray-600 text-sm">No preview</div>
              )}
              <div className="p-3 space-y-1">
                <p className="text-xs text-gray-300 line-clamp-2">{item.prompt}</p>
                <p className="text-xs text-gray-500">{new Date(item.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail view */}
      {selected && (
        <div className="mt-6 bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-4">
          <video src={`/videos/${selected.filename}`} controls className="w-full max-w-2xl rounded-lg" />
          <div className="space-y-2 text-sm text-gray-400">
            <p><span className="text-gray-300 font-medium">Prompt:</span> {selected.prompt}</p>
            <p><span className="text-gray-300 font-medium">Model:</span> {selected.modelId}</p>
            <p><span className="text-gray-300 font-medium">Seed:</span> {selected.seed}</p>
            <p><span className="text-gray-300 font-medium">Resolution:</span> {selected.width}x{selected.height}</p>
            <p><span className="text-gray-300 font-medium">Frames:</span> {selected.numFrames} @ {selected.fps}fps</p>
          </div>
          <div className="flex gap-4">
            <a href={`/videos/${selected.filename}`} download className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg">Download</a>
            <button onClick={() => handleDelete(selected.id)} className="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-sm rounded-lg border border-red-700">Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}
