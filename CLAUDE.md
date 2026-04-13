# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies
npm run install:all

# Development (starts both server and UI via PM2, tails logs)
npm run dev

# Stop dev
npm run dev:stop

# Production (builds client, starts PM2)
npm start

# PM2 management
pm2 start ecosystem.config.cjs
pm2 stop ecosystem.config.cjs
pm2 restart ecosystem.config.cjs
pm2 logs
```

## Architecture

Pixie Forge is a PortOS-compatible monorepo with Express.js server (port 5570) and React/Vite client (port 5571). PM2 manages app lifecycles. Data persists to JSON files in `~/.pixie-forge/`. Runs on macOS (Apple Silicon) and Windows.

### Port Allocation

| Port | Process | Label | Description |
|------|---------|-------|-------------|
| 5570 | pixie-server | api | Express API server |
| 5571 | pixie-ui | ui | Vite dev server (React UI) |

### Server (`server/`)
- `index.js` - Express app, static file serving, route mounting
- `settings.js` - Settings management (`~/.pixie-forge/settings.json`)
- `routes/generate.js` - Video generation via Python subprocess with SSE progress
- `routes/imagine.js` - Image generation via mflux-generate with SSE progress and LoRA support
- `routes/history.js` - Video history CRUD
- `routes/settings.js` - Settings API, Python detection, package validation
- `routes/models.js` - Model manager: list cached HF models, LoRAs, disk usage, delete

### Client (`client/src/`)
- `App.jsx` - Router and nav layout
- `pages/ImaginePage.jsx` - Flux image generation with LoRAs, gallery, and "Send to Video" workflow
- `pages/GeneratePage.jsx` - Video generation form with real-time progress
- `pages/HistoryPage.jsx` - Video archive with thumbnails
- `pages/ModelsPage.jsx` - Model manager: disk usage, cached models, LoRAs, delete
- `pages/SettingsPage.jsx` - Python path, output dir, API keys

### Image Generation
- Uses `mflux-generate` CLI (installed via `pip install mflux`)
- Supports Flux 2 Klein (4B/9B), Flux 1 Dev, Flux 1 Schnell
- LoRA support via `.safetensors` files in `~/.pixie-forge/loras/`
- Images stored in `~/.pixie-forge/images/`
- Metadata stored as `.metadata.json` files (mflux format)

### Video Generation
- Uses `python -m mlx_video.generate_av` subprocess
- Supports LTX-2 and LTX-2.3 models

## Code Conventions

- **CommonJS** - server uses `require()`
- **ESM** - client uses `import`
- **No try/catch** unless strictly necessary
- **Functional programming** - no classes, hooks in React
- **Single-line logging** - emoji prefixes with key values
- **No hardcoded localhost** - use `window.location.hostname` for URLs
- **Cross-platform** - all server code must work on macOS and Windows
