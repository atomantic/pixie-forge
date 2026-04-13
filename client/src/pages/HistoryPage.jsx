import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function HistoryPage() {
  const navigate = useNavigate()
  const [history, setHistory] = useState([])
  const [selected, setSelected] = useState(null)
  const [stitchMode, setStitchMode] = useState(false)
  const [stitchSelection, setStitchSelection] = useState([])
  const [stitching, setStitching] = useState(false)
  const [extracting, setExtracting] = useState(false)

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

  async function handleContinue(id) {
    setExtracting(true)
    const res = await fetch(`/api/generate/last-frame/${id}`, { method: 'POST' })
    const data = await res.json()
    setExtracting(false)
    if (data.filename) {
      navigate(`/generate?sourceImageUrl=${encodeURIComponent(data.url)}`)
    }
  }

  function toggleStitchItem(id) {
    setStitchSelection(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleStitch() {
    if (stitchSelection.length < 2) return
    setStitching(true)
    const res = await fetch('/api/generate/stitch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoIds: stitchSelection }),
    })
    const data = await res.json()
    setStitching(false)
    if (data.ok) {
      setStitchMode(false)
      setStitchSelection([])
      // Reload history
      fetch('/api/history').then(r => r.json()).then(setHistory).catch(() => {})
      setSelected(data.video)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-xl font-semibold text-white">Video History</h2>
        {history.length >= 2 && (
          <button
            onClick={() => { setStitchMode(!stitchMode); setStitchSelection([]) }}
            className={`px-3 py-1.5 text-sm rounded border ${
              stitchMode
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'
            }`}
          >
            {stitchMode ? 'Cancel Stitch' : 'Stitch Videos'}
          </button>
        )}
        {stitchMode && stitchSelection.length >= 2 && (
          <button
            onClick={handleStitch}
            disabled={stitching}
            className="px-3 py-1.5 text-sm rounded bg-green-600 hover:bg-green-700 text-white"
          >
            {stitching ? 'Stitching...' : `Stitch ${stitchSelection.length} Videos`}
          </button>
        )}
      </div>

      {stitchMode && (
        <p className="text-xs text-gray-500 mb-4">Click videos in the order you want them stitched. Numbers show the sequence.</p>
      )}

      {history.length === 0 ? (
        <p className="text-gray-500 text-sm">No videos generated yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {history.map(item => {
            const stitchIdx = stitchSelection.indexOf(item.id)
            return (
              <div
                key={item.id}
                className={`bg-gray-900 border rounded-lg overflow-hidden cursor-pointer transition-all hover:border-indigo-500 ${
                  stitchMode && stitchIdx >= 0
                    ? 'border-green-500 ring-2 ring-green-500/50'
                    : selected?.id === item.id
                      ? 'border-indigo-500 ring-2 ring-indigo-500/50'
                      : 'border-gray-700'
                }`}
                onClick={() => stitchMode ? toggleStitchItem(item.id) : setSelected(item)}
              >
                <div className="relative">
                  {item.thumbnail ? (
                    <img src={`/thumbnails/${item.thumbnail}`} alt="" className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video bg-gray-800 flex items-center justify-center text-gray-600 text-sm">No preview</div>
                  )}
                  {stitchMode && stitchIdx >= 0 && (
                    <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-green-600 text-white text-xs flex items-center justify-center font-bold">
                      {stitchIdx + 1}
                    </div>
                  )}
                </div>
                <div className="p-3 space-y-1">
                  <p className="text-xs text-gray-300 line-clamp-2">{item.prompt}</p>
                  <p className="text-xs text-gray-500">{new Date(item.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail view */}
      {selected && !stitchMode && (
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
            <button
              onClick={() => handleContinue(selected.id)}
              disabled={extracting}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white text-sm rounded-lg"
            >
              {extracting ? 'Extracting...' : 'Continue from Last Frame'}
            </button>
            <a href={`/videos/${selected.filename}`} download className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg">Download</a>
            <button onClick={() => handleDelete(selected.id)} className="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-sm rounded-lg border border-red-700">Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}
