const express = require('express')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { getSettings, DATA_DIR } = require('../settings')

const router = express.Router()

const IMAGES_DIR = path.join(DATA_DIR, 'images')
const LORAS_DIR = path.join(DATA_DIR, 'loras')

// Ensure directories exist
for (const dir of [IMAGES_DIR, LORAS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

const IS_MAC = process.platform === 'darwin'
const MODELS = {
  dev: { name: 'Flux 1 Dev', steps: 20, guidance: 3.5 },
  schnell: { name: 'Flux 1 Schnell', steps: 4, guidance: 0 },
  'flux2-klein-4b': { name: 'Flux 2 Klein 4B', steps: 8, guidance: 3.5, broken: IS_MAC },
  'flux2-klein-9b': { name: 'Flux 2 Klein 9B', steps: 8, guidance: 3.5, broken: IS_MAC },
}

const jobs = new Map()
let activeProcess = null

router.get('/models', (req, res) => {
  res.json(Object.entries(MODELS).filter(([, m]) => !m.broken).map(([id, m]) => ({ id, ...m })))
})

// List available LoRA files from the loras directory
router.get('/loras', (req, res) => {
  const loras = []
  if (fs.existsSync(LORAS_DIR)) {
    for (const f of fs.readdirSync(LORAS_DIR)) {
      if (f.endsWith('.safetensors')) {
        loras.push({
          filename: f,
          name: f.replace(/^lora-/, '').replace(/\.safetensors$/, ''),
          path: path.join(LORAS_DIR, f),
        })
      }
    }
  }
  res.json(loras)
})

router.post('/', (req, res) => {
  const settings = getSettings()
  if (!settings.pythonPath) {
    return res.status(400).json({ error: 'Python path not configured. Go to Settings.' })
  }

  const jobId = uuidv4()
  const {
    prompt, negativePrompt = '', modelId = 'flux2-klein-4b',
    width = '1024', height = '1024',
    steps, guidance, seed = '', quantize = '8',
    loraPaths = [], loraScales = [],
  } = req.body

  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'Prompt is required' })
  }

  const model = MODELS[modelId]
  if (!model) {
    return res.status(400).json({ error: `Unknown model: ${modelId}` })
  }

  const filename = `${jobId}.png`
  const outputPath = path.join(IMAGES_DIR, filename)
  const actualSeed = seed ? parseInt(seed, 10) : Math.floor(Math.random() * 2147483647)
  const actualSteps = steps ? parseInt(steps, 10) : model.steps
  const actualGuidance = guidance !== undefined && guidance !== '' ? parseFloat(guidance) : model.guidance

  // On Windows use the diffusers-based Python script; on macOS use mflux-generate
  let spawnBin, args
  if (process.platform === 'win32') {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'imagine_win.py')
    spawnBin = settings.pythonPath
    args = [scriptPath]
  } else {
    const pythonDir = path.dirname(settings.pythonPath)
    spawnBin = path.join(pythonDir, 'mflux-generate')
    args = []
  }

  args.push(
    '--model', modelId,
    '--prompt', prompt,
    '--height', String(parseInt(height, 10)),
    '--width', String(parseInt(width, 10)),
    '--steps', String(actualSteps),
    '--seed', String(actualSeed),
    '--quantize', String(quantize),
    '--output', outputPath,
    '--metadata',
  )

  if (actualGuidance > 0) {
    args.push('--guidance', String(actualGuidance))
  }
  if (negativePrompt.trim()) {
    args.push('--negative-prompt', negativePrompt)
  }

  // LoRA support
  const validLoras = loraPaths.filter(p => p && fs.existsSync(p))
  if (validLoras.length > 0) {
    args.push('--lora-paths', ...validLoras)
    if (loraScales.length > 0) {
      args.push('--lora-scales', ...loraScales.map(String))
    }
  }

  const jobMeta = {
    id: jobId,
    prompt,
    negativePrompt,
    modelId,
    seed: actualSeed,
    width: parseInt(width, 10),
    height: parseInt(height, 10),
    steps: actualSteps,
    guidance: actualGuidance,
    filename,
    createdAt: new Date().toISOString(),
  }
  const job = { ...jobMeta, clients: [], status: 'running' }
  jobs.set(jobId, job)

  console.log(`🎨 Starting image generation: ${modelId} ${parseInt(width, 10)}x${parseInt(height, 10)} steps=${actualSteps}`)

  const proc = spawn(spawnBin, args, {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeProcess = proc

  function broadcast(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`
    for (const client of job.clients) {
      client.write(msg)
    }
  }

  // Lines to suppress from stderr (xformers/triton warnings, bitsandbytes noise)
  const NOISE_RE = /xformers|xFormers|triton|Triton|bitsandbytes|Please reinstall|Memory-efficient|Set XFORMERS|FutureWarning|UserWarning|DeprecationWarning|torch\.distributed|Unable to import.*torchao|Skipping import of cpp|NOTE: Redirects/i

  let stderrBuffer = ''
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    stderrBuffer += text
    const lines = text.split(/[\n\r]+/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || NOISE_RE.test(trimmed)) continue

      // mflux outputs progress like "100%|████| 8/8 [00:05<00:00,  1.43it/s]"
      const progressMatch = trimmed.match(/(\d+)%\|/)
      if (progressMatch) {
        const pct = parseInt(progressMatch[1], 10) / 100
        broadcast({ type: 'progress', progress: pct, message: trimmed })
      } else {
        broadcast({ type: 'status', message: trimmed })
      }
    }
  })

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    const lines = text.split(/[\n\r]+/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) broadcast({ type: 'status', message: trimmed })
    }
  })

  proc.on('close', (code, signal) => {
    activeProcess = null

    if (code !== 0) {
      job.status = 'error'
      const reason = signal ? `Killed by signal ${signal}` : `Exit code ${code}`
      const lastLines = stderrBuffer.trim().split('\n').slice(-10).join('\n')
      console.log(`❌ Image generation failed: ${reason}\n${lastLines}`)
      broadcast({ type: 'error', error: `Generation failed: ${reason}\n${lastLines}` })
    } else {
      job.status = 'complete'
      console.log(`✅ Image generated: ${filename}`)
      broadcast({
        type: 'complete',
        result: { filename, seed: actualSeed },
      })
    }

    setTimeout(() => {
      for (const client of job.clients) client.end()
      jobs.delete(jobId)
    }, 5000)
  })

  res.json({ jobId })
})

router.get('/:jobId/events', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  job.clients.push(res)

  req.on('close', () => {
    job.clients = job.clients.filter(c => c !== res)
  })
})

router.post('/cancel', (req, res) => {
  if (activeProcess) {
    activeProcess.kill('SIGTERM')
    activeProcess = null
  }
  res.json({ ok: true })
})

// List generated images
router.get('/gallery', (req, res) => {
  if (!fs.existsSync(IMAGES_DIR)) return res.json([])
  const files = fs.readdirSync(IMAGES_DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => {
      const stat = fs.statSync(path.join(IMAGES_DIR, f))
      // Try to read mflux metadata JSON
      const metaPath = path.join(IMAGES_DIR, f.replace('.png', '.metadata.json'))
      let meta = {}
      if (fs.existsSync(metaPath)) {
        const raw = fs.readFileSync(metaPath, 'utf8')
        meta = JSON.parse(raw)
      }
      return {
        filename: f,
        createdAt: stat.birthtime.toISOString(),
        ...meta,
      }
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  res.json(files)
})

// Delete an image
router.delete('/:filename', (req, res) => {
  const filename = req.params.filename
  if (!filename.endsWith('.png') || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' })
  }
  const filePath = path.join(IMAGES_DIR, filename)
  const metaPath = filePath.replace('.png', '.metadata.json')
  fs.rm(filePath, { force: true }, () => {})
  fs.rm(metaPath, { force: true }, () => {})
  res.json({ ok: true })
})

module.exports = { imagineRouter: router, IMAGES_DIR }
