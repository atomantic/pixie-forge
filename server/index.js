const express = require('express')
const path = require('path')
const { generateRouter } = require('./routes/generate')
const { historyRouter } = require('./routes/history')
const { settingsRouter } = require('./routes/settings')
const { imagineRouter, IMAGES_DIR } = require('./routes/imagine')
const { modelsRouter } = require('./routes/models')
const { getSettings, onSettingsChange } = require('./settings')

const PORT = process.env.PORT || 5570
const HOST = process.env.HOST || '0.0.0.0'
const app = express()

app.use(express.json())

let videosStatic = null
let thumbnailsStatic = null

function rebuildStaticMiddleware() {
  const settings = getSettings()
  videosStatic = express.static(settings.videosDir)
  thumbnailsStatic = express.static(settings.thumbnailsDir)
}
rebuildStaticMiddleware()
onSettingsChange(rebuildStaticMiddleware)

app.use('/videos', (req, res, next) => videosStatic(req, res, next))
app.use('/thumbnails', (req, res, next) => thumbnailsStatic(req, res, next))
app.use('/images', express.static(IMAGES_DIR))

app.use('/api/generate', generateRouter)
app.use('/api/history', historyRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/imagine', imagineRouter)
app.use('/api/models', modelsRouter)

app.get('/api/status', (req, res) => {
  const settings = getSettings()
  res.json({
    python: settings.pythonPath || null,
    outputDir: settings.videosDir,
  })
})

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist')
  app.use(express.static(clientDist))
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.listen(PORT, HOST, () => {
  console.log(`🚀 Pixie Forge running on http://${HOST}:${PORT}`)
})
