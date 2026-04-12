const fs = require('fs')
const path = require('path')
const os = require('os')

const DATA_DIR = path.join(os.homedir(), '.ltx-web-local')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

const DEFAULTS = {
  pythonPath: '',
  outputDir: '',
  elevenLabsApiKey: '',
}

function ensureDataDir() {
  const dirs = [
    DATA_DIR,
    path.join(DATA_DIR, 'videos'),
    path.join(DATA_DIR, 'thumbnails'),
  ]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function loadSettings() {
  ensureDataDir()
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULTS }
  const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
  return { ...DEFAULTS, ...JSON.parse(raw) }
}

const changeListeners = []

function saveSettings(settings) {
  ensureDataDir()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 })
  for (const fn of changeListeners) fn()
}

function onSettingsChange(fn) {
  changeListeners.push(fn)
}

function getSettings() {
  const s = loadSettings()
  const videosDir = s.outputDir || path.join(DATA_DIR, 'videos')
  const thumbnailsDir = path.join(DATA_DIR, 'thumbnails')
  return { ...s, videosDir, thumbnailsDir, dataDir: DATA_DIR }
}

module.exports = { loadSettings, saveSettings, getSettings, onSettingsChange, DATA_DIR }
