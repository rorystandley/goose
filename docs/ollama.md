# Ollama Setup

Ollama is the default LLM backend for Goose. It runs large language models locally on your machine using llama.cpp under the hood.

---

## What is Ollama?

[Ollama](https://ollama.com) is a tool for running open-source LLMs locally. It handles model downloading, quantisation, and serving behind a simple API. Models run entirely on your hardware — no data leaves your machine.

Key features:
- **One-command model downloads** — `ollama pull qwen3:14b`
- **Automatic GPU acceleration** — uses Metal on Mac, CUDA on Linux
- **Hot-swapping** — can serve multiple models, loading/unloading as needed
- **REST API** — `http://localhost:11434` by default

---

## Installation

### macOS

```bash
# Download from ollama.com (recommended)
open https://ollama.com/download

# Or via Homebrew
brew install ollama
```

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Verify installation

```bash
ollama --version
```

---

## Pulling a model

Goose defaults to `qwen2.5:14b`. Pull it before first use:

```bash
ollama pull qwen2.5:14b
```

Other recommended models:

| Model | Size | VRAM | Best for |
|---|---|---|---|
| `qwen2.5:7b` | 4.7 GB | ~5 GB | Fast responses, simple tasks |
| `qwen2.5:14b` | 9.0 GB | ~10 GB | Good balance of speed and quality |
| `qwen3:14b` | 9.3 GB | ~10 GB | Better reasoning, thinking support |
| `qwen2.5:32b` | 19 GB | ~20 GB | Best quality, needs 24GB+ RAM |

To see what you have installed:

```bash
ollama list
```

---

## Starting the server

Ollama runs as a background service. On macOS it starts automatically when you open the app. On Linux:

```bash
# Start the server
ollama serve

# Or run as a systemd service (installed automatically on Linux)
sudo systemctl start ollama
```

Verify it's running:

```bash
curl http://localhost:11434/api/tags
```

---

## Configuration

In your `.env` file:

```bash
# These are the defaults — only change if needed
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
```

### Multi-model routing (optional)

Route simple tasks to a fast model and complex tasks to a capable model:

```bash
FAST_MODEL=qwen2.5:7b        # Simple lookups, quick questions
SMART_MODEL=qwen2.5:32b      # Complex reasoning, multi-step tasks
ROUTING_MODEL=llama3.2:3b    # Tiny model that decides fast vs smart (optional)
```

When both `FAST_MODEL` and `SMART_MODEL` are set, Goose uses keyword heuristics (or the routing model if configured) to choose the right model per task. See [the router source](../src/agent/router.js) for the heuristic rules.

When routing is not configured, all tasks use `OLLAMA_MODEL`.

---

## Troubleshooting

### "Ollama unreachable"

1. Check Ollama is running: `curl http://localhost:11434/api/tags`
2. If using a custom host, verify `OLLAMA_HOST` in `.env` matches
3. On macOS, make sure the Ollama app is open (look for the llama icon in the menu bar)

### "Model not found"

```bash
ollama pull qwen2.5:14b    # Download the model
ollama list                 # Verify it's available
```

### Slow responses

- Check VRAM usage: `ollama ps` shows which models are loaded and where
- If the model is running in CPU mode (no GPU), responses will be 5-10x slower
- Try a smaller model: `qwen2.5:7b` is 2x faster than `14b`
- Close other GPU-intensive apps (browsers with hardware acceleration, video editors)

### Memory issues

Each model needs VRAM roughly equal to its file size:
- 7B models: ~5 GB
- 14B models: ~10 GB
- 32B models: ~20 GB

On Apple Silicon, VRAM is shared with system RAM. A Mac with 16 GB can comfortably run 14B models. 24 GB+ is recommended for 32B models.

---

## Further reading

- [Ollama documentation](https://github.com/ollama/ollama/blob/main/README.md)
- [Ollama model library](https://ollama.com/library)
- [Goose multi-model routing](../src/agent/router.js)
