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
  const [negativePrompt, setNegativePrompt] = useState('bad quality, worst quality, worst detail, sketch, censor, signature, watermark, username, ugly, duplicate, morbid, mutilated, poorly drawn face, poorly drawn hands, mutation, deformed, blurry, bad anatomy, bad proportions, extra limbs, disfigured, fused fingers, too many fingers, long neck, multiple hands, multiple heads')
  const [modelId, setModelId] = useState('dev')
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
  const [preview, setPreview] = useState(null)
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

  // Map mflux metadata model strings back to our model IDs
  const MODEL_REVERSE = {
    'black-forest-labs/FLUX.1-dev': 'dev',
    'black-forest-labs/FLUX.1-schnell': 'schnell',
    'black-forest-labs/FLUX.1-Fill-dev': 'dev',
    'FLUX.1-dev': 'dev',
    'FLUX.1-schnell': 'schnell',
    dev: 'dev',
    schnell: 'schnell',
    'flux2-klein-4b': 'flux2-klein-4b',
    'flux2-klein-9b': 'flux2-klein-9b',
  }

  function handleRemix(img) {
    if (img.prompt) setPrompt(img.prompt)
    if (img.negative_prompt) setNegativePrompt(img.negative_prompt)
    if (img.seed != null) setSeed(String(img.seed))
    if (img.steps) setSteps(String(img.steps))
    if (img.guidance != null) setGuidance(String(img.guidance))
    if (img.quantize) setQuantize(String(img.quantize))
    if (img.width) setWidth(img.width)
    if (img.height) setHeight(img.height)

    const metaModel = img.model || img.base_model || ''
    const mappedId = MODEL_REVERSE[metaModel]
    if (mappedId) setModelId(mappedId)

    // Restore LoRAs if they're still available
    if (img.lora_paths?.length) {
      const restored = img.lora_paths.map((p, i) => {
        const match = availableLoras.find(l => l.path === p || l.filename === p.split('/').pop())
        if (!match) return null
        return { path: match.path, name: match.name, scale: img.lora_scales?.[i] ?? 1.0 }
      }).filter(Boolean)
      setSelectedLoras(restored)
    } else {
      setSelectedLoras([])
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleCopyPrompt(text) {
    navigator.clipboard.writeText(text)
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
            {gallery.map(img => {
              const modelShort = (img.model || '').split('/').pop() || img.base_model || '?'
              const loras = (img.lora_paths || []).map(p => p.split('/').pop().replace(/^lora-/, '').replace(/\.safetensors$/, ''))
              return (
                <div key={img.filename} className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden group">
                  <img
                    src={`/images/${img.filename}`}
                    alt=""
                    className="w-full aspect-square object-cover cursor-pointer"
                    onClick={() => setPreview(img)}
                  />
                  <div className="p-3 space-y-1.5">
                    {img.prompt && (
                      <div className="flex items-start gap-1">
                        <p className="text-xs text-gray-300 line-clamp-2 flex-1">{img.prompt}</p>
                        <button
                          onClick={() => handleCopyPrompt(img.prompt)}
                          className="shrink-0 p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
                          title="Copy prompt"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
                            <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <span className="text-[10px] px-1.5 py-0.5 bg-indigo-600/20 text-indigo-300 rounded">{modelShort}</span>
                      {img.steps && <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">{img.steps}steps</span>}
                      {img.guidance != null && <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">cfg {img.guidance}</span>}
                      {img.quantize && <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">q{img.quantize}</span>}
                      {img.width && <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">{img.width}x{img.height}</span>}
                      {img.seed != null && <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded">seed {img.seed}</span>}
                    </div>
                    {loras.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {loras.map(l => <span key={l} className="text-[10px] px-1.5 py-0.5 bg-purple-600/20 text-purple-300 rounded">{l}</span>)}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-600">{new Date(img.createdAt).toLocaleDateString()}{img.generation_time_seconds ? ` (${img.generation_time_seconds.toFixed(1)}s)` : ''}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRemix(img)}
                        className="flex-1 px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-xs rounded border border-indigo-700"
                      >
                        Remix
                      </button>
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
              )
            })}
          </div>
        </div>
      )}

      {/* Full-size preview lightbox */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
            <img
              src={`/images/${preview.filename}`}
              alt=""
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <a
                href={`/images/${preview.filename}`}
                download
                className="px-3 py-1.5 bg-gray-800/80 hover:bg-gray-700 text-white text-xs rounded-lg backdrop-blur"
              >
                Download
              </a>
              <button
                onClick={() => setPreview(null)}
                className="px-3 py-1.5 bg-gray-800/80 hover:bg-gray-700 text-white text-xs rounded-lg backdrop-blur"
              >
                Close
              </button>
            </div>
            {preview.prompt && (
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg">
                <p className="text-sm text-gray-200">{preview.prompt}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
