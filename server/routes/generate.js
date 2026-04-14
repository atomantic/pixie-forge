const express = require('express')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const multer = require('multer')
const { getSettings, DATA_DIR } = require('../settings')
const { loadHistory, saveHistory } = require('./history')

const router = express.Router()

const IMAGES_DIR = path.join(DATA_DIR, 'images')

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

const MODELS_MACOS = {
  ltx2_unified:       { name: 'LTX-2 Unified (~42 GB)',          repo: 'notapalindrome/ltx2-mlx-av',      steps: 30, guidance: 3.0, i2v: true },
  ltx23_unified:      { name: 'LTX-2.3 Unified Beta (~48 GB)',   repo: 'notapalindrome/ltx23-mlx-av',     steps: 25, guidance: 3.0, i2v: true },
  ltx23_distilled_q4: { name: 'LTX-2.3 Distilled Q4 (~22 GB, T2V only)', repo: 'notapalindrome/ltx23-mlx-av-q4', steps: 25, guidance: 3.0, i2v: false },
}

const MODELS_WINDOWS = {
  ltx_video: { name: 'LTX-Video 0.9.5 — T2V + I2V (~9.5 GB, auto-downloads)', steps: 25, guidance: 3.0, i2v: true },
}

const MODELS = process.platform === 'win32' ? MODELS_WINDOWS : MODELS_MACOS

router.get('/models', (req, res) => {
  res.json(Object.entries(MODELS).map(([id, m]) => ({ id, ...m })))
})

router.post('/', upload.single('sourceImage'), (req, res) => {
  console.log(`📥 Generate request: file=${req.file?.originalname || 'none'} sourceImageFile=${req.body.sourceImageFile || 'none'}`)
  const settings = getSettings()
  if (!settings.pythonPath) {
    return res.status(400).json({ error: 'Python path not configured. Go to Settings.' })
  }

  const jobId = uuidv4()
  const defaultModelId = process.platform === 'win32' ? 'ltx_video' : 'ltx2_unified'
  const {
    prompt, negativePrompt = '', modelId = defaultModelId,
    width = '768', height = '512', numFrames = '121',
    fps = '24', steps, guidanceScale, seed = '',
    tiling = 'auto', disableAudio = 'false',
  } = req.body

  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'Prompt is required' })
  }

  const model = MODELS[modelId]
  if (!model) {
    return res.status(400).json({ error: `Unknown model: ${modelId}` })
  }

  const filename = `${jobId}.mp4`
  const outputPath = path.join(settings.videosDir, filename)
  const actualSeed = seed ? parseInt(seed, 10) : Math.floor(Math.random() * 2147483647)
  const actualSteps = steps ? parseInt(steps, 10) : model.steps
  const actualGuidance = guidanceScale !== undefined && guidanceScale !== '' ? parseFloat(guidanceScale) : model.guidance

  const w = Math.floor(parseInt(width, 10) / 64) * 64
  const h = Math.floor(parseInt(height, 10) / 64) * 64
  const parsedNumFrames = parseInt(numFrames, 10)
  const parsedFps = parseInt(fps, 10)

  // Resolve source image from upload or from the images gallery
  let sourceImagePath = null
  if (req.file) {
    sourceImagePath = req.file.path
  } else if (req.body.sourceImageFile) {
    const localPath = path.join(IMAGES_DIR, path.basename(req.body.sourceImageFile))
    if (fs.existsSync(localPath)) {
      sourceImagePath = localPath
    } else {
      console.log(`⚠️ Source image not found: ${localPath}`)
    }
  }
  // Reject I2V with models whose VAE corrupts the conditioned first frames
  if (sourceImagePath && model.i2v === false) {
    if (req.file) fs.unlink(req.file.path, () => {})
    return res.status(400).json({ error: `Model ${modelId} does not support Image-to-Video. Pick a non-quantized model.` })
  }
  // Resize source image to match target video resolution before passing to model
  if (sourceImagePath) {
    const ffmpeg = findFfmpeg()
    if (ffmpeg) {
      const resizedPath = path.join(require('os').tmpdir(), `resized-${jobId}.png`)
      const { execFileSync } = require('child_process')
      try {
        execFileSync(ffmpeg, [
          '-i', sourceImagePath,
          '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
          '-y', resizedPath,
        ], { timeout: 10000 })
        console.log(`🖼️ Image-to-Video mode: ${sourceImagePath} → resized to ${w}x${h}`)
        sourceImagePath = resizedPath
      } catch (err) {
        console.log(`⚠️ Failed to resize source image, using original: ${err.message}`)
      }
    }
  }

  // Build spawn args — platform-specific backends
  let spawnBin, args
  if (process.platform === 'win32') {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_win.py')
    spawnBin = settings.pythonPath
    args = [
      scriptPath,
      '--model', modelId,
      '--prompt', prompt,
      '--height', String(h),
      '--width', String(w),
      '--num-frames', String(parsedNumFrames),
      '--fps', String(parsedFps),
      '--steps', String(actualSteps),
      '--guidance', String(actualGuidance),
      '--seed', String(actualSeed),
      '--output', outputPath,
    ]
    if (negativePrompt.trim()) args.push('--negative-prompt', negativePrompt)
    if (sourceImagePath) args.push('--image', sourceImagePath)
  } else {
    spawnBin = settings.pythonPath
    args = [
      '-m', 'mlx_video.generate_av',
      '--prompt', prompt,
      '--height', String(h),
      '--width', String(w),
      '--num-frames', String(parsedNumFrames),
      '--seed', String(actualSeed),
      '--fps', String(parsedFps),
      '--steps', String(actualSteps),
      '--cfg-scale', String(actualGuidance),
      '--output-path', outputPath,
      '--model-repo', model.repo,
      '--text-encoder-repo', 'mlx-community/gemma-3-12b-it-4bit',
      '--tiling', tiling,
    ]
    if (negativePrompt.trim()) args.push('--negative-prompt', negativePrompt)
    if (disableAudio === 'true') args.push('--no-audio')
    if (sourceImagePath) args.push('--image', sourceImagePath)
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

  console.log(`🎬 Starting video generation: ${modelId} ${w}x${h} frames=${parsedNumFrames} steps=${actualSteps}`)
  const proc = spawn(spawnBin, args, {
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

  // Suppress noisy warnings from xformers / triton / bitsandbytes on Windows
  const NOISE_RE = /xformers|xFormers|triton|Triton|bitsandbytes|Please reinstall|Memory-efficient|Set XFORMERS|FutureWarning|UserWarning|DeprecationWarning|torch\.distributed|Unable to import.*torchao|Skipping import of cpp|NOTE: Redirects/i

  function handleLine(line) {
    line = line.trim()
    if (!line || NOISE_RE.test(line)) return

    if (line.startsWith('STATUS:')) {
      broadcast({ type: 'status', message: line.slice(7) })
    } else if (line.startsWith('STAGE:')) {
      const parts = line.split(':')
      const step = parseInt(parts[3], 10) || 0
      const total = parseInt(parts[4], 10) || 1
      broadcast({ type: 'progress', progress: step / total, message: parts.slice(5).join(':') })
    } else if (line.startsWith('DOWNLOAD:')) {
      broadcast({ type: 'status', message: `Downloading model... ${line.slice(9)}` })
    } else {
      // tqdm-style progress: "50%|████████████▒▒▒▒▒▒▒▒| 1/2"
      const progressMatch = line.match(/(\d+)%\|/)
      if (progressMatch) {
        const pct = parseInt(progressMatch[1], 10) / 100
        broadcast({ type: 'progress', progress: pct, message: line })
      }
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
    // Clean up resized temp image
    const resizedTmp = path.join(require('os').tmpdir(), `resized-${jobId}.png`)
    fs.unlink(resizedTmp, () => {})

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

function findFfmpeg() {
  const candidates = process.platform === 'win32'
    ? ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']
    : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  const { execFileSync } = require('child_process')
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    return execFileSync(cmd, ['ffmpeg'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
  } catch { return null }
}

async function generateThumbnail(videoPath, jobId, thumbnailsDir) {
  const thumbFilename = `${jobId}.jpg`
  const thumbPath = path.join(thumbnailsDir, thumbFilename)
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return null

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, [
      '-i', videoPath, '-vframes', '1', '-q:v', '5', '-y', thumbPath,
    ], { stdio: 'ignore' })
    proc.on('close', (code) => resolve(code === 0 ? thumbFilename : null))
  })
}

// Extract last frame from a video as a PNG for continuation
router.post('/last-frame/:id', (req, res) => {
  const settings = getSettings()
  const history = loadHistory()
  const item = history.find(h => h.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Video not found' })

  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return res.status(500).json({ error: 'ffmpeg not found' })

  const videoPath = path.join(settings.videosDir, item.filename)
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video file not found' })

  const frameFilename = `lastframe-${item.id}.png`
  const framePath = path.join(IMAGES_DIR, frameFilename)

  // sseof seeks from end of file to grab the last frame
  const proc = spawn(ffmpeg, [
    '-sseof', '-0.1', '-i', videoPath,
    '-vframes', '1', '-q:v', '2', '-y', framePath,
  ], { stdio: 'ignore' })

  proc.on('close', (code) => {
    if (code !== 0) return res.status(500).json({ error: 'Failed to extract last frame' })
    console.log(`🎞️ Extracted last frame: ${frameFilename}`)
    res.json({ filename: frameFilename, url: `/images/${frameFilename}` })
  })
})

// Stitch multiple videos together
router.post('/stitch', (req, res) => {
  const settings = getSettings()
  const { videoIds } = req.body
  if (!videoIds?.length || videoIds.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 videos to stitch' })
  }

  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return res.status(500).json({ error: 'ffmpeg not found' })

  const history = loadHistory()
  const videos = videoIds.map(id => history.find(h => h.id === id)).filter(Boolean)
  if (videos.length < 2) return res.status(400).json({ error: 'Videos not found' })

  // Verify all files exist
  const videoPaths = videos.map(v => path.join(settings.videosDir, v.filename))
  for (const p of videoPaths) {
    if (!fs.existsSync(p)) return res.status(404).json({ error: `Missing: ${path.basename(p)}` })
  }

  // Create concat list file
  const jobId = uuidv4()
  const listFile = path.join(require('os').tmpdir(), `concat-${jobId}.txt`)
  const listContent = videoPaths.map(p => `file '${p}'`).join('\n')
  fs.writeFileSync(listFile, listContent)

  const outFilename = `stitched-${jobId}.mp4`
  const outPath = path.join(settings.videosDir, outFilename)

  const proc = spawn(ffmpeg, [
    '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', outPath,
  ], { stdio: 'ignore' })

  proc.on('close', (code) => {
    fs.unlink(listFile, () => {})
    if (code !== 0) return res.status(500).json({ error: 'Stitch failed' })

    console.log(`🎬 Stitched ${videos.length} videos: ${outFilename}`)

    // Add to history
    generateThumbnail(outPath, jobId, settings.thumbnailsDir).then(thumb => {
      const stitchedMeta = {
        id: jobId,
        prompt: `Stitched: ${videos.map(v => v.prompt).join(' + ')}`,
        modelId: videos[0].modelId,
        seed: 0,
        width: videos[0].width,
        height: videos[0].height,
        numFrames: videos.reduce((sum, v) => sum + (v.numFrames || 0), 0),
        fps: videos[0].fps,
        filename: outFilename,
        thumbnail: thumb,
        createdAt: new Date().toISOString(),
        stitchedFrom: videoIds,
      }
      const h = loadHistory()
      h.unshift(stitchedMeta)
      saveHistory(h)
      res.json({ ok: true, video: stitchedMeta })
    })
  })
})

module.exports = { generateRouter: router }
