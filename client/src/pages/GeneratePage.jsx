import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

const MODELS = [
  { id: 'ltx2_unified', repo: 'notapalindrome/ltx2-mlx-av', name: 'LTX-2 Unified', size: '~42GB', stepsRange: [20, 40] },
  { id: 'ltx23_unified', repo: 'notapalindrome/ltx23-mlx-av', name: 'LTX-2.3 Unified (Beta)', size: '~48GB', stepsRange: [15, 30] },
  { id: 'ltx23_distilled_q4', repo: 'notapalindrome/ltx23-mlx-av-q4', name: 'LTX-2.3 Distilled Q4 (Beta)', size: '~22GB', stepsRange: [15, 30] },
]

const RESOLUTIONS = [
  { label: '512x320 (fast)', w: 512, h: 320 },
  { label: '768x512 (default)', w: 768, h: 512 },
  { label: '1024x576 (HD)', w: 1024, h: 576 },
]

const FRAME_COUNTS = [25, 33, 49, 65, 81, 97, 121]

const TILING_MODES = ['auto', 'none', 'default', 'aggressive', 'conservative', 'spatial', 'temporal']

export default function GeneratePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [modelId, setModelId] = useState('ltx23_distilled_q4')
  const [width, setWidth] = useState(768)
  const [height, setHeight] = useState(512)
  const [numFrames, setNumFrames] = useState(121)
  const [fps, setFps] = useState(24)
  const [steps, setSteps] = useState(30)
  const [guidanceScale, setGuidanceScale] = useState(3.0)
  const [seed, setSeed] = useState('')
  const [tiling, setTiling] = useState('auto')
  const [disableAudio, setDisableAudio] = useState(false)
  const [sourceImage, setSourceImage] = useState(null)
  const [sourceImageUrl, setSourceImageUrl] = useState(null)

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const eventSourceRef = useRef(null)

  const sourceImagePreview = useMemo(() => {
    if (!sourceImage) return null
    const url = URL.createObjectURL(sourceImage)
    return url
  }, [sourceImage])

  useEffect(() => {
    return () => {
      if (sourceImagePreview) URL.revokeObjectURL(sourceImagePreview)
    }
  }, [sourceImagePreview])

  // Load source image from query param (sent from Imagine page)
  useEffect(() => {
    const imageUrl = searchParams.get('sourceImageUrl')
    if (imageUrl) {
      setSourceImageUrl(imageUrl)
      // Fetch the image and convert to a File object for upload
      fetch(imageUrl)
        .then(r => r.blob())
        .then(blob => {
          const file = new File([blob], 'source.png', { type: 'image/png' })
          setSourceImage(file)
          // Clean the URL param
          setSearchParams({}, { replace: true })
        })
        .catch(() => {})
    }
  }, [])

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => { eventSourceRef.current?.close() }
  }, [])

  function handleResolutionChange(e) {
    const r = RESOLUTIONS.find(r => r.label === e.target.value)
    if (r) { setWidth(r.w); setHeight(r.h) }
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (file) setSourceImage(file)
  }

  function clearImage() {
    setSourceImage(null)
  }

  async function handleGenerate(e) {
    e.preventDefault()
    if (!prompt.trim() || generating) return

    setGenerating(true)
    setProgress(null)
    setStatusMsg('Starting...')
    setResult(null)
    setError(null)

    const formData = new FormData()
    formData.append('prompt', prompt)
    formData.append('negativePrompt', negativePrompt)
    formData.append('modelId', modelId)
    formData.append('width', width)
    formData.append('height', height)
    formData.append('numFrames', numFrames)
    formData.append('fps', fps)
    formData.append('steps', steps)
    formData.append('guidanceScale', guidanceScale)
    formData.append('seed', seed || '')
    formData.append('tiling', tiling)
    formData.append('disableAudio', disableAudio)
    if (sourceImage) formData.append('sourceImage', sourceImage)

    try {
      const res = await fetch('/api/generate', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Generation failed')
        setGenerating(false)
        return
      }

      const jobId = data.jobId
      const es = new EventSource(`/api/generate/${jobId}/events`)
      eventSourceRef.current = es

      es.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'status') setStatusMsg(msg.message)
        if (msg.type === 'progress') setProgress(msg.progress)
        if (msg.type === 'complete') {
          setResult(msg.result)
          setGenerating(false)
          setProgress(1)
          setStatusMsg('Complete')
          es.close()
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
    } catch (err) {
      setError(err.message)
      setGenerating(false)
    }
  }

  function handleCancel() {
    eventSourceRef.current?.close()
    fetch('/api/generate/cancel', { method: 'POST' }).catch(() => {})
    setGenerating(false)
    setStatusMsg('Cancelled')
  }

  const videoLength = (numFrames / fps).toFixed(1)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <form onSubmit={handleGenerate} className="space-y-6">
        {/* Prompt */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={4}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
            placeholder="Describe the video you want to generate..."
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

        {/* Source Image (Image-to-Video) */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Source Image (optional, for Image-to-Video)</label>
          <div className="flex items-center gap-4">
            <input type="file" accept="image/*" onChange={handleImageSelect} className="text-sm text-gray-400" />
            {sourceImagePreview && (
              <div className="relative">
                <img src={sourceImagePreview} alt="Source" className="h-16 w-16 object-cover rounded border border-gray-700" />
                <button type="button" onClick={clearImage} className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">X</button>
              </div>
            )}
          </div>
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Model</label>
            <select value={modelId} onChange={e => setModelId(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200">
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.name} ({m.size})</option>)}
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

          {/* Frames */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Frames ({videoLength}s at {fps}fps)</label>
            <select value={numFrames} onChange={e => setNumFrames(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200">
              {FRAME_COUNTS.map(f => <option key={f} value={f}>{f} frames ({(f/fps).toFixed(1)}s)</option>)}
            </select>
          </div>

          {/* FPS */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">FPS</label>
            <select value={fps} onChange={e => setFps(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200">
              {[16, 24, 30].map(f => <option key={f} value={f}>{f} fps{f === 24 ? ' (recommended)' : ''}</option>)}
            </select>
          </div>

          {/* Steps */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Inference Steps ({steps})</label>
            <input type="range" min={5} max={50} value={steps} onChange={e => setSteps(Number(e.target.value))} className="w-full" />
          </div>

          {/* Guidance Scale */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Guidance Scale ({guidanceScale})</label>
            <input type="range" min={1} max={10} step={0.5} value={guidanceScale} onChange={e => setGuidanceScale(Number(e.target.value))} className="w-full" />
          </div>

          {/* Seed */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Seed (blank = random)</label>
            <input type="number" value={seed} onChange={e => setSeed(e.target.value)} placeholder="Random" className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200" />
          </div>

          {/* Tiling */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">VAE Tiling</label>
            <select value={tiling} onChange={e => setTiling(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200">
              {TILING_MODES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Audio toggle */}
          <div className="flex items-center gap-2 pt-5">
            <input type="checkbox" id="disableAudio" checked={disableAudio} onChange={e => setDisableAudio(e.target.checked)} className="rounded" />
            <label htmlFor="disableAudio" className="text-sm text-gray-300">Disable audio</label>
          </div>
        </div>

        {/* Generate / Cancel */}
        <div className="flex gap-4">
          {generating ? (
            <button type="button" onClick={handleCancel} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors">
              Cancel
            </button>
          ) : (
            <button type="submit" disabled={!prompt.trim()} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors">
              Generate
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
          <h3 className="text-sm font-medium text-gray-300">Generated Video</h3>
          <video
            src={`/videos/${result.filename}`}
            controls
            autoPlay
            className="w-full rounded-lg"
          />
          <div className="flex gap-4 text-xs text-gray-500">
            <span>Seed: {result.seed}</span>
            <a href={`/videos/${result.filename}`} download className="text-indigo-400 hover:text-indigo-300">Download</a>
          </div>
        </div>
      )}
    </div>
  )
}
