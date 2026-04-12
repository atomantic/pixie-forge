import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const RESOLUTIONS = [
  { label: '512x512', w: 512, h: 512 },
  { label: '768x768', w: 768, h: 768 },
  { label: '1024x1024 (default)', w: 1024, h: 1024 },
  { label: '1024x768 (landscape)', w: 1024, h: 768 },
  { label: '768x1024 (portrait)', w: 768, h: 1024 },
  { label: '1024x576 (16:9)', w: 1024, h: 576 },
  { label: '576x1024 (9:16)', w: 576, h: 1024 },
]

export default function ImaginePage() {
  const navigate = useNavigate()
  const [models, setModels] = useState([])
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [modelId, setModelId] = useState('flux2-klein-4b')
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)
  const [steps, setSteps] = useState('')
  const [guidance, setGuidance] = useState('')
  const [seed, setSeed] = useState('')
  const [quantize, setQuantize] = useState('8')
  const [availableLoras, setAvailableLoras] = useState([])
  const [selectedLoras, setSelectedLoras] = useState([]) // [{path, name, scale}]

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [gallery, setGallery] = useState([])
  const eventSourceRef = useRef(null)

  useEffect(() => {
    fetch('/api/imagine/models').then(r => r.json()).then(setModels).catch(() => {})
    fetch('/api/imagine/loras').then(r => r.json()).then(setAvailableLoras).catch(() => {})
    loadGallery()
    return () => { eventSourceRef.current?.close() }
  }, [])

  function loadGallery() {
    fetch('/api/imagine/gallery').then(r => r.json()).then(setGallery).catch(() => {})
  }

  function handleResolutionChange(e) {
    const r = RESOLUTIONS.find(r => r.label === e.target.value)
    if (r) { setWidth(r.w); setHeight(r.h) }
  }

  // When model changes, reset steps/guidance to model defaults
  function handleModelChange(newModelId) {
    setModelId(newModelId)
    setSteps('')
    setGuidance('')
  }

  const currentModel = models.find(m => m.id === modelId)
  const displaySteps = steps || currentModel?.steps || '—'
  const displayGuidance = guidance || currentModel?.guidance || '—'

  async function handleGenerate(e) {
    e.preventDefault()
    if (!prompt.trim() || generating) return

    setGenerating(true)
    setProgress(null)
    setStatusMsg('Starting...')
    setResult(null)
    setError(null)

    const body = {
      prompt, negativePrompt, modelId,
      width: String(width), height: String(height),
      steps: steps || undefined,
      guidance: guidance || undefined,
      seed: seed || undefined,
      quantize,
      loraPaths: selectedLoras.map(l => l.path),
      loraScales: selectedLoras.map(l => l.scale),
    }

    const res = await fetch('/api/imagine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Generation failed')
      setGenerating(false)
      return
    }

    const jobId = data.jobId
    const es = new EventSource(`/api/imagine/${jobId}/events`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') setStatusMsg(msg.message)
      if (msg.type === 'progress') {
        setProgress(msg.progress)
        setStatusMsg(msg.message)
      }
      if (msg.type === 'complete') {
        setResult(msg.result)
        setGenerating(false)
        setProgress(1)
        setStatusMsg('Complete')
        es.close()
        loadGallery()
      }
      if (msg.type === 'error') {
        setError(msg.error)
        setGenerating(false)
        es.close()
      }
    }
    es.onerror = () => {
      setError('Lost connection to server')
      setGenerating(false)
      es.close()
    }
  }

  function handleCancel() {
    eventSourceRef.current?.close()
    fetch('/api/imagine/cancel', { method: 'POST' }).catch(() => {})
    setGenerating(false)
    setStatusMsg('Cancelled')
  }

  function sendToVideo(imageFilename) {
    // Navigate to generate page with the image filename as a query param
    navigate(`/generate?sourceImageUrl=${encodeURIComponent(`/images/${imageFilename}`)}`)
  }

  function handleDeleteImage(filename) {
    fetch(`/api/imagine/${filename}`, { method: 'DELETE' })
      .then(() => setGallery(g => g.filter(img => img.filename !== filename)))
      .catch(() => {})
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <form onSubmit={handleGenerate} className="space-y-6">
        {/* Prompt */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
            placeholder="Describe the image you want to generate..."
          />
        </div>

        {/* Negative Prompt */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Negative Prompt (optional)</label>
          <textarea
            value={negativePrompt}
            onChange={e => setNegativePrompt(e.target.value)}
            rows={2}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
            placeholder="What to avoid..."
          />
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Model</label>
            <select value={modelId} onChange={e => handleModelChange(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200">
              {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {/* Resolution */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Resolution</label>
            <select
              value={RESOLUTIONS.find(r => r.w === width && r.h === height)?.label || ''}
              onChange={handleResolutionChange}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            >
              {RESOLUTIONS.map(r => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </div>

          {/* Steps */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Steps (default: {currentModel?.steps || '—'})</label>
            <input
              type="number" min={1} max={50}
              value={steps}
              onChange={e => setSteps(e.target.value)}
              placeholder={String(currentModel?.steps || '')}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            />
          </div>

          {/* Guidance */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Guidance (default: {currentModel?.guidance || '—'})</label>
            <input
              type="number" min={0} max={20} step={0.5}
              value={guidance}
              onChange={e => setGuidance(e.target.value)}
              placeholder={String(currentModel?.guidance || '')}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            />
          </div>

          {/* Quantize */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Quantize (bits)</label>
            <select value={quantize} onChange={e => setQuantize(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200">
              {['3', '4', '5', '6', '8'].map(q => <option key={q} value={q}>{q}-bit{q === '8' ? ' (default)' : q === '4' ? ' (fast)' : ''}</option>)}
            </select>
          </div>

          {/* Seed */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Seed (blank = random)</label>
            <input
              type="number"
              value={seed}
              onChange={e => setSeed(e.target.value)}
              placeholder="Random"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            />
          </div>
        </div>

        {/* LoRA Selection */}
        {availableLoras.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">LoRAs</label>
            <div className="space-y-2">
              {availableLoras.map(lora => {
                const selected = selectedLoras.find(s => s.path === lora.path)
                return (
                  <div key={lora.path} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedLoras(prev => [...prev, { path: lora.path, name: lora.name, scale: 1.0 }])
                          } else {
                            setSelectedLoras(prev => prev.filter(s => s.path !== lora.path))
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-300">{lora.name}</span>
                    </label>
                    {selected && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500">Scale:</label>
                        <input
                          type="number" min={0} max={2} step={0.1}
                          value={selected.scale}
                          onChange={e => {
                            const scale = parseFloat(e.target.value) || 0
                            setSelectedLoras(prev => prev.map(s => s.path === lora.path ? { ...s, scale } : s))
                          }}
                          className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Generate / Cancel */}
        <div className="flex gap-4">
          {generating ? (
            <button type="button" onClick={handleCancel} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors">
              Cancel
            </button>
          ) : (
            <button type="submit" disabled={!prompt.trim()} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors">
              Generate Image
            </button>
          )}
        </div>
      </form>

      {/* Progress */}
      {generating && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">{statusMsg}</span>
            {progress != null && <span className="text-indigo-400">{Math.round(progress * 100)}%</span>}
          </div>
          {progress != null && (
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-300">Generated Image</h3>
          <img
            src={`/images/${result.filename}`}
            alt="Generated"
            className="max-w-full rounded-lg"
          />
          <div className="flex gap-4 items-center">
            <span className="text-xs text-gray-500">Seed: {result.seed}</span>
            <a href={`/images/${result.filename}`} download className="text-xs text-indigo-400 hover:text-indigo-300">Download</a>
            <button
              onClick={() => sendToVideo(result.filename)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Send to Video
            </button>
          </div>
        </div>
      )}

      {/* Gallery */}
      {gallery.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-white mb-4">Gallery</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {gallery.map(img => (
              <div key={img.filename} className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden group">
                <img src={`/images/${img.filename}`} alt="" className="w-full aspect-square object-cover" />
                <div className="p-3 space-y-2">
                  {img.prompt && <p className="text-xs text-gray-400 line-clamp-2">{img.prompt}</p>}
                  <p className="text-xs text-gray-600">{new Date(img.createdAt).toLocaleDateString()}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => sendToVideo(img.filename)}
                      className="flex-1 px-2 py-1 bg-green-600/20 hover:bg-green-600/40 text-green-400 text-xs rounded border border-green-700"
                    >
                      Send to Video
                    </button>
                    <button
                      onClick={() => handleDeleteImage(img.filename)}
                      className="px-2 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded border border-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
