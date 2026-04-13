const express = require('express')
const fs = require('fs')
const { execFile, spawn } = require('child_process')
const { loadSettings, saveSettings, getSettings } = require('../settings')

const router = express.Router()

// mlx and related packages are Apple Silicon (macOS) only
const REQUIRED_PACKAGES_MACOS = [
  'mlx', 'mlx_vlm', 'mlx_video', 'transformers',
  'safetensors', 'huggingface_hub', 'numpy', 'cv2', 'tqdm',
]
const REQUIRED_PACKAGES_WINDOWS = [
  'transformers', 'safetensors', 'huggingface_hub', 'numpy', 'cv2', 'tqdm',
]
const REQUIRED_PACKAGES = process.platform === 'win32' ? REQUIRED_PACKAGES_WINDOWS : REQUIRED_PACKAGES_MACOS

router.get('/', (req, res) => {
  const s = loadSettings()
  // Don't expose the full API key to the client
  res.json({
    pythonPath: s.pythonPath,
    outputDir: s.outputDir,
    elevenLabsApiKey: s.elevenLabsApiKey ? '***configured***' : '',
  })
})

router.put('/', (req, res) => {
  const current = loadSettings()
  const { pythonPath, outputDir, elevenLabsApiKey } = req.body

  if (pythonPath !== undefined) current.pythonPath = pythonPath
  if (outputDir !== undefined) current.outputDir = outputDir
  // Only update API key if it's not the masked value
  if (elevenLabsApiKey !== undefined && elevenLabsApiKey !== '***configured***') {
    current.elevenLabsApiKey = elevenLabsApiKey
  }

  saveSettings(current)
  res.json({ ok: true })
})

router.post('/detect-python', (req, res) => {
  const home = require('os').homedir()
  const path = require('path')

  const candidates = process.platform === 'win32'
    ? [
        path.join(home, '.pixie-forge', 'venv', 'Scripts', 'python.exe'),
        path.join(home, 'miniconda3', 'python.exe'),
        path.join(home, 'anaconda3', 'python.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
        'C:\\Python313\\python.exe',
        'C:\\Python312\\python.exe',
        'C:\\Python311\\python.exe',
      ]
    : [
        `${home}/.pixie-forge/venv/bin/python3`,
        '/opt/miniconda3/bin/python3',
        `${home}/miniconda3/bin/python3`,
        `${home}/.pyenv/shims/python3`,
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/usr/bin/python3',
      ]

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return res.json({ path: p })
    } catch {
      // not found, try next
    }
  }

  // Fall back to PATH lookup
  const { execFileSync } = require('child_process')
  const names = process.platform === 'win32' ? ['python'] : ['python3', 'python']
  const which = process.platform === 'win32' ? 'where' : 'which'
  for (const name of names) {
    try {
      const found = execFileSync(which, [name], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
      if (found) return res.json({ path: found })
    } catch { /* not found */ }
  }

  res.json({ path: null, error: 'No Python 3 installation found' })
})

router.post('/validate', (req, res) => {
  const settings = getSettings()
  if (!settings.pythonPath) {
    return res.json({ success: false, message: 'No Python path configured' })
  }

  const script = REQUIRED_PACKAGES.map(pkg =>
    `try:\n import ${pkg}\n print("OK:${pkg}")\nexcept Exception:\n print("MISSING:${pkg}")`
  ).join('\n')

  execFile(settings.pythonPath, ['-c', script], { timeout: 30000 }, (err, stdout) => {
    if (err) {
      return res.json({ success: false, message: `Python error: ${err.message}` })
    }

    // Split on \r\n or \n to handle Windows line endings
    const lines = stdout.trim().split(/\r?\n/)
    const missing = lines.filter(l => l.startsWith('MISSING:')).map(l => l.slice(8).trim())

    if (missing.length === 0) {
      return res.json({ success: true, message: 'All required packages installed.' })
    }

    // Map import names back to pip install specifiers
    const pipNames = {
      mlx_vlm: 'mlx-vlm',
      mlx_video: 'mlx-video-with-audio',
      cv2: 'opencv-python',
      huggingface_hub: 'huggingface_hub',
      // transformers<5 only needed for mlx compatibility on macOS
      ...(process.platform !== 'win32' ? { transformers: 'transformers<5' } : {}),
    }
    const missingPip = missing.map(m => pipNames[m] || m)

    res.json({
      success: false,
      message: `Missing ${missing.length} package(s). Install with: pip install ${missingPip.join(' ')}`,
      missingPackages: missingPip,
    })
  })
})

// SSE endpoint: pip install missing packages with real-time log streaming
router.get('/install-packages', (req, res) => {
  const settings = getSettings()
  if (!settings.pythonPath) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'No Python path configured' })}\n\n`)
    return res.end()
  }

  const packages = (req.query.packages || '').split(',').filter(Boolean)
  if (packages.length === 0) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'No packages specified' })}\n\n`)
    return res.end()
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  send({ type: 'log', message: `Installing: ${packages.join(' ')}` })

  const proc = spawn(settings.pythonPath, ['-m', 'pip', 'install', '--progress-bar', 'on', ...packages], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  function handleOutput(chunk) {
    const lines = chunk.toString().split(/[\r\n]+/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) send({ type: 'log', message: trimmed })
    }
  }

  proc.stdout.on('data', handleOutput)
  proc.stderr.on('data', handleOutput)

  proc.on('close', (code) => {
    if (code === 0) {
      send({ type: 'complete', message: 'All packages installed successfully.' })
    } else {
      send({ type: 'error', message: `pip exited with code ${code}` })
    }
    res.end()
  })

  req.on('close', () => {
    proc.kill('SIGTERM')
  })
})

module.exports = { settingsRouter: router }
