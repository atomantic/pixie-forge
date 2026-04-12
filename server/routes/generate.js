const express = require('express')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const multer = require('multer')
const { getSettings } = require('../settings')
const { loadHistory, saveHistory } = require('./history')

const router = express.Router()

const jobs = new Map()
let activeProcess = null

const upload = multer({
  dest: path.join(require('os').tmpdir(), 'ltx-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files allowed'))
  },
})

const MODELS = {
  ltx2_unified: 'notapalindrome/ltx2-mlx-av',
  ltx23_unified: 'notapalindrome/ltx23-mlx-av',
  ltx23_distilled_q4: 'notapalindrome/ltx23-mlx-av-q4',
}

router.post('/', upload.single('sourceImage'), (req, res) => {
  const settings = getSettings()
  if (!settings.pythonPath) {
    return res.status(400).json({ error: 'Python path not configured. Go to Settings.' })
  }

  const jobId = uuidv4()
  const {
    prompt, negativePrompt = '', modelId = 'ltx2_unified',
    width = '768', height = '512', numFrames = '121',
    fps = '24', steps = '30', guidanceScale = '3.0',
    seed = '', tiling = 'auto', disableAudio = 'false',
  } = req.body

  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'Prompt is required' })
  }

  const modelRepo = MODELS[modelId]
  if (!modelRepo) {
    return res.status(400).json({ error: `Unknown model: ${modelId}` })
  }

  const filename = `${jobId}.mp4`
  const outputPath = path.join(settings.videosDir, filename)
  const actualSeed = seed ? parseInt(seed, 10) : Math.floor(Math.random() * 2147483647)

  const w = Math.floor(parseInt(width, 10) / 64) * 64
  const h = Math.floor(parseInt(height, 10) / 64) * 64
  const parsedNumFrames = parseInt(numFrames, 10)
  const parsedFps = parseInt(fps, 10)

  const args = [
    '-m', 'mlx_video.generate_av',
    '--prompt', prompt,
    '--height', String(h),
    '--width', String(w),
    '--num-frames', String(numFrames),
    '--seed', String(actualSeed),
    '--fps', String(fps),
    '--steps', String(steps),
    '--cfg-scale', String(guidanceScale),
    '--output-path', outputPath,
    '--model-repo', modelRepo,
    '--text-encoder-repo', 'mlx-community/gemma-3-12b-it-4bit',
    '--tiling', tiling,
  ]

  if (negativePrompt.trim()) {
    args.push('--negative-prompt', negativePrompt)
  }
  if (disableAudio === 'true') {
    args.push('--no-audio')
  }
  if (req.file) {
    args.push('--image', req.file.path)
  }

  const jobMeta = {
    id: jobId,
    prompt,
    modelId,
    seed: actualSeed,
    width: w,
    height: h,
    numFrames: parsedNumFrames,
    fps: parsedFps,
    filename,
    createdAt: new Date().toISOString(),
  }
  const job = { ...jobMeta, clients: [], status: 'running' }
  jobs.set(jobId, job)

  const proc = spawn(settings.pythonPath, args, {
    env: { ...process.env, PYTHONPATH: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeProcess = proc

  let outputBuf = ''

  function broadcast(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`
    for (const client of job.clients) {
      client.write(msg)
    }
  }

  function handleLine(line) {
    line = line.trim()
    if (!line) return

    if (line.startsWith('STATUS:')) {
      broadcast({ type: 'status', message: line.slice(7) })
    } else if (line.startsWith('STAGE:')) {
      const parts = line.split(':')
      const step = parseInt(parts[3], 10) || 0
      const total = parseInt(parts[4], 10) || 1
      broadcast({ type: 'progress', progress: step / total, message: parts.slice(5).join(':') })
    } else if (line.startsWith('DOWNLOAD:')) {
      broadcast({ type: 'status', message: `Downloading model... ${line.slice(9)}` })
    }
  }

  proc.stdout.on('data', (chunk) => {
    outputBuf += chunk.toString()
    const lines = outputBuf.split('\n')
    outputBuf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line.trim())
        if (parsed.video_path) job.resultJson = parsed
      } catch { /* not JSON */ }
    }
  })

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    const lines = text.split(/[\n\r]+/)
    for (const line of lines) handleLine(line)
  })

  proc.on('close', (code, signal) => {
    activeProcess = null
    if (req.file) fs.unlink(req.file.path, () => {})

    if (code !== 0) {
      job.status = 'error'
      const reason = signal === 'SIGKILL' ? 'Process killed (likely out of memory — try a smaller model or resolution)'
        : signal ? `Killed by signal ${signal}`
        : `Exit code ${code}`
      broadcast({ type: 'error', error: `Generation failed: ${reason}` })
    } else {
      job.status = 'complete'
      generateThumbnail(outputPath, jobId, settings.thumbnailsDir).then(thumbFilename => {
        const history = loadHistory()
        history.unshift({ ...jobMeta, thumbnail: thumbFilename })
        saveHistory(history)

        broadcast({
          type: 'complete',
          result: { filename, seed: actualSeed, thumbnail: thumbFilename },
        })
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

// Cancel active generation
router.post('/cancel', (req, res) => {
  if (activeProcess) {
    activeProcess.kill('SIGTERM')
    activeProcess = null
  }
  res.json({ ok: true })
})

async function generateThumbnail(videoPath, jobId, thumbnailsDir) {
  const thumbFilename = `${jobId}.jpg`
  const thumbPath = path.join(thumbnailsDir, thumbFilename)

  // Try ffmpeg for thumbnail extraction
  const ffmpegCandidates = process.platform === 'win32'
    ? ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']
    : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
  let ffmpeg = null
  for (const p of ffmpegCandidates) {
    if (fs.existsSync(p)) { ffmpeg = p; break }
  }
  // Fall back to PATH lookup
  if (!ffmpeg) {
    const { execFileSync } = require('child_process')
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    try {
      ffmpeg = execFileSync(cmd, ['ffmpeg'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
    } catch { /* not found */ }
  }

  if (!ffmpeg) return null

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, [
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '5',
      '-y', thumbPath,
    ], { stdio: 'ignore' })

    proc.on('close', (code) => {
      resolve(code === 0 ? thumbFilename : null)
    })
  })
}

module.exports = { generateRouter: router }
