# Pixie Forge - Development Plan

Local AI image and video generation studio. Express/React/Tailwind with PM2 process management, PortOS-compatible.

## Architecture

PortOS-compatible monorepo managed by PM2.

- **Server** (`ltx-server`): Express.js on port 5570
  - Spawns `python -m mlx_video.generate_av` as subprocess
  - Parses STATUS:/STAGE: lines from stderr for progress
  - SSE (Server-Sent Events) for real-time progress to browser
  - Multer for image uploads (I2V mode)
  - Settings stored in `~/.pixie-forge/settings.json`
  - History stored in `~/.pixie-forge/history.json`
  - Videos stored in `~/.pixie-forge/videos/`

- **Client** (`ltx-ui`): React + Vite + Tailwind CSS on port 5571
  - `/` - Generate page (prompt, params, progress, result)
  - `/history` - Video archive with thumbnails and playback
  - `/settings` - Python path, output dir, API keys

## Phase 1 (current) - Core Generation
- [x] Express server with subprocess bridge to mlx_video
- [x] React UI with generation form, parameters, progress bar
- [x] SSE-based real-time progress streaming
- [x] History management (save, browse, delete)
- [x] Settings (Python detection, validation, output dir)
- [x] Image-to-video support via file upload
- [x] Video thumbnails via ffmpeg

## Phase 1.5 (current) - Image Generation with Flux
- [x] Flux image generation via mflux-generate subprocess
- [x] Support for Flux 2 Klein (4B/9B), Flux 1 Dev, Flux 1 Schnell
- [x] Imagine page with prompt, model, resolution, steps, guidance, quantize, seed
- [x] Image gallery with metadata from mflux
- [x] "Send to Video" workflow: generated image → Video page as source image
- [x] SSE progress streaming during generation

## Phase 2 - Audio Features
- [ ] Voiceover with MLX-Audio (local TTS)
- [ ] ElevenLabs TTS integration
- [ ] Background music generation
- [ ] Audio mixing/merging with ffmpeg

## Phase 3 - Enhanced UX
- [ ] Generation queue (multiple jobs)
- [ ] Preset save/load
- [ ] Gemma prompt enhancement preview
- [ ] Drag-and-drop image upload
- [ ] Batch generation

## Phase 4 - Polish
- [ ] Toast notifications (no window.alert)
- [ ] Keyboard shortcuts
- [ ] Dark/light theme
- [ ] Export/share options

## Security improvements over the Swift version
- Args passed as array to spawn() (no string interpolation / injection)
- Settings file written with 0o600 permissions
- Data dir created with 0o700 permissions
- API key masked in GET responses
- Image uploads validated by mimetype
- No eval/exec of user input
