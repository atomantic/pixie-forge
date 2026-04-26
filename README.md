# Pixie Forge

> **⚠️ This project has been merged into the core of [PortOS](https://github.com/atomantic/PortOS) and is no longer maintained as a separate app.** See [PortOS#161](https://github.com/atomantic/PortOS/pull/161) for the merge. This repository is archived — please use PortOS for ongoing development and updates.

A simplified, custom local web server for AI image and video generation on macOS (Apple Silicon) and Windows. Built as a [PortOS](https://github.com/atomantic/portos)-compatible app.

Pixie Forge provides a clean browser UI for generating images with [Flux](https://huggingface.co/black-forest-labs) models and videos with [LTX-Video](https://huggingface.co/Lightricks/LTX-Video) models, all running locally on your hardware with no cloud dependencies.

## Features

- **Image Generation** - Flux 1 Dev, Flux 1 Schnell via [mflux](https://github.com/filipstrand/mflux) (macOS) or diffusers (Windows)
- **Video Generation** - LTX-2 and LTX-2.3 models via [mlx_video](https://github.com/notapalindrome/mlx-video) with audio support
- **Image-to-Video** - Use generated images as conditioning input for video generation
- **LoRA Support** - Load `.safetensors` LoRA files for image generation
- **Model Manager** - Browse cached HuggingFace models, view disk usage, delete unused models
- **Real-time Progress** - SSE-based live progress updates during generation
- **Gallery** - Browse and manage generated images with metadata
- **Video History** - Archive of generated videos with thumbnails and stitching
- **Continue from Last Frame** - Extract the last frame of a video to chain generations
- **Cross-platform** - macOS (Apple Silicon) and Windows

## Prerequisites

- **Node.js** 18+
- **Python 3.10+** with pip
- **macOS**: `pip install mflux` for image generation
- **Windows**: `pip install torch diffusers transformers accelerate` for image generation
- **Video generation**: `pip install mlx-video` (macOS Apple Silicon only)
- **ffmpeg** (for video thumbnails and frame extraction)

## Quick Start

```bash
# Clone the repo
git clone https://github.com/atomantic/pixie-forge.git
cd pixie-forge

# Install dependencies
npm run install:all

# Start development server
npm run dev
```

Open [http://localhost:5571](http://localhost:5571) in your browser.

On first launch, go to **Settings** to configure your Python path. The app will validate that required packages are installed.

## Commands

```bash
# Install all dependencies (server + client)
npm run install:all

# Development (starts API server + Vite dev server via PM2, tails logs)
npm run dev

# Stop dev servers
npm run dev:stop

# Production (builds client, starts PM2)
npm start

# PM2 management
npm run pm2:start
npm run pm2:stop
npm run pm2:restart
npm run pm2:logs
npm run pm2:status
```

## Architecture

Pixie Forge is a monorepo with an Express.js API server and a React/Vite client. PM2 manages both processes.

| Port | Process | Description |
|------|---------|-------------|
| 5570 | pixie-server | Express API server |
| 5571 | pixie-ui | Vite dev server (React UI) |

### Data Storage

All user data persists to `~/.pixie-forge/`:

```
~/.pixie-forge/
  settings.json     # Python path, output dir, API keys
  images/           # Generated images + metadata
  loras/            # LoRA .safetensors files
  videos/           # Generated videos
  thumbnails/       # Video thumbnails
  history.json      # Video generation history
```

### Image Generation

Uses `mflux-generate` on macOS and a diffusers-based Python script on Windows:

- **Flux 1 Dev** - 20 steps, high quality
- **Flux 1 Schnell** - 4 steps, fast generation
- Configurable resolution, guidance scale, quantization (3-8 bit), and seed
- LoRA support with adjustable scale per adapter
- Negative prompt support

### Video Generation

Uses `python -m mlx_video.generate_av` (macOS Apple Silicon):

- **LTX-2 Unified** - Text/image-to-video with audio
- **LTX-2.3 Unified** - Improved quality (beta)
- **LTX-2.3 Distilled Q4** - Quantized for lower memory (beta)
- Configurable resolution, frame count, FPS, inference steps, guidance scale
- VAE tiling modes for memory management
- Image-to-video conditioning with adjustable strength
- Optional audio generation

## License

MIT
