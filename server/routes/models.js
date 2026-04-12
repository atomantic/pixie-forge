const express = require('express')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const { DATA_DIR } = require('../settings')

const router = express.Router()
const IS_WIN = process.platform === 'win32'

const HF_CACHE_DIR = path.join(os.homedir(), '.cache', 'huggingface', 'hub')
const LORAS_DIR = path.join(DATA_DIR, 'loras')
const IMAGES_DIR = path.join(DATA_DIR, 'images')

// Known models used by this app, for labeling purposes
const APP_MODELS = {
  'black-forest-labs--FLUX.1-schnell': 'Flux 1 Schnell (Image)',
  'black-forest-labs--FLUX.1-dev': 'Flux 1 Dev (Image)',
  'notapalindrome--ltx2-mlx-av': 'LTX-2 Unified (Video)',
  'notapalindrome--ltx23-mlx-av': 'LTX-2.3 Unified (Video)',
  'notapalindrome--ltx23-mlx-av-q4': 'LTX-2.3 Distilled Q4 (Video)',
  'mlx-community--gemma-3-12b-it-4bit': 'Gemma 3 12B 4-bit (Text Encoder)',
}

function getDirSize(dirPath) {
  if (IS_WIN) {
    // PowerShell one-liner for directory size on Windows
    const result = execFileSync('powershell', [
      '-NoProfile', '-Command',
      `(Get-ChildItem -Recurse -File '${dirPath}' | Measure-Object -Property Length -Sum).Sum`,
    ], { encoding: 'utf8', timeout: 30000 })
    return parseInt(result.trim(), 10) || 0
  }
  const result = execFileSync('du', ['-sk', dirPath], { encoding: 'utf8', timeout: 30000 })
  const kb = parseInt(result.split('\t')[0], 10)
  return kb * 1024
}

// List all HuggingFace cached models
router.get('/', (req, res) => {
  if (!fs.existsSync(HF_CACHE_DIR)) return res.json({ models: [], loras: [], diskUsage: {} })

  const entries = fs.readdirSync(HF_CACHE_DIR).filter(f => f.startsWith('models--'))
  const models = entries.map(dirName => {
    const fullPath = path.join(HF_CACHE_DIR, dirName)
    const modelKey = dirName.replace('models--', '')
    const [org, name] = modelKey.split('--')
    const size = getDirSize(fullPath)
    return {
      id: dirName,
      org,
      name,
      repo: `${org}/${name}`,
      label: APP_MODELS[modelKey] || null,
      size,
      sizeHuman: formatBytes(size),
      path: fullPath,
    }
  }).sort((a, b) => b.size - a.size)

  // LoRA files
  const loras = []
  if (fs.existsSync(LORAS_DIR)) {
    for (const f of fs.readdirSync(LORAS_DIR)) {
      if (f.endsWith('.safetensors')) {
        const filePath = path.join(LORAS_DIR, f)
        const stat = fs.statSync(filePath)
        loras.push({
          filename: f,
          name: f.replace(/^lora-/, '').replace(/\.safetensors$/, ''),
          size: stat.size,
          sizeHuman: formatBytes(stat.size),
        })
      }
    }
  }

  // Disk usage summary
  const totalModels = models.reduce((sum, m) => sum + m.size, 0)
  const totalLoras = loras.reduce((sum, l) => sum + l.size, 0)

  // Images directory size
  let totalImages = 0
  if (fs.existsSync(IMAGES_DIR)) {
    totalImages = getDirSize(IMAGES_DIR)
  }

  res.json({
    models,
    loras,
    diskUsage: {
      models: formatBytes(totalModels),
      loras: formatBytes(totalLoras),
      images: formatBytes(totalImages),
      total: formatBytes(totalModels + totalLoras + totalImages),
    },
  })
})

// Delete a cached HuggingFace model
router.delete('/hf/:dirName', (req, res) => {
  const dirName = req.params.dirName
  if (!dirName.startsWith('models--') || dirName.includes('/') || dirName.includes('\\') || dirName.includes('..')) {
    return res.status(400).json({ error: 'Invalid model directory name' })
  }
  const fullPath = path.join(HF_CACHE_DIR, dirName)
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Model not found' })
  }
  console.log(`🗑️ Deleting model cache: ${dirName}`)
  fs.rmSync(fullPath, { recursive: true, force: true })
  res.json({ ok: true })
})

// Delete a LoRA file
router.delete('/lora/:filename', (req, res) => {
  const filename = req.params.filename
  if (!filename.endsWith('.safetensors') || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' })
  }
  const filePath = path.join(LORAS_DIR, filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'LoRA not found' })
  }
  console.log(`🗑️ Deleting LoRA: ${filename}`)
  fs.rmSync(filePath, { force: true })
  res.json({ ok: true })
})

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i]
}

module.exports = { modelsRouter: router }
