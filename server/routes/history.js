const express = require('express')
const fs = require('fs')
const path = require('path')
const { getSettings, DATA_DIR } = require('../settings')

const router = express.Router()
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), { mode: 0o600 })
}

router.get('/', (req, res) => {
  res.json(loadHistory())
})

router.delete('/:id', (req, res) => {
  const settings = getSettings()
  const history = loadHistory()
  const item = history.find(h => h.id === req.params.id)

  if (!item) return res.status(404).json({ error: 'Not found' })

  const videoPath = path.join(settings.videosDir, item.filename)
  fs.rm(videoPath, { force: true }, () => {})

  if (item.thumbnail) {
    const thumbPath = path.join(settings.thumbnailsDir, item.thumbnail)
    fs.rm(thumbPath, { force: true }, () => {})
  }

  const updated = history.filter(h => h.id !== req.params.id)
  saveHistory(updated)
  res.json({ ok: true })
})

module.exports = { historyRouter: router, loadHistory, saveHistory }
