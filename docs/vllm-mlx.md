# vllm-mlx Setup

vllm-mlx is an alternative LLM backend for Goose, purpose-built for Apple Silicon. It uses Apple's [MLX](https://github.com/ml-explore/mlx) framework instead of llama.cpp, offering faster inference and support for models that Ollama can't run.

---

## What is vllm-mlx?

[vllm-mlx](https://github.com/waybarrios/vllm-mlx) is an OpenAI and Anthropic compatible inference server for Apple Silicon. It uses Apple's MLX framework and exposes an **OpenAI-compatible API**, so any tool that works with the OpenAI API works with vllm-mlx.

Key advantages over Ollama:
- **Native Apple Silicon** — MLX is built by Apple specifically for M-series chips
- **20-50% faster inference** — better memory bandwidth utilisation on unified memory
- **MoE model support** — can run Mixture-of-Experts models like Qwen3.5-35B-A3B that Ollama can't
- **OpenAI-compatible API** — standard `/v1/chat/completions` endpoint with tool calling

---

## Why Qwen3.5-35B-A3B?

The recommended model for vllm-mlx is **Qwen3.5-35B-A3B** — a Mixture-of-Experts (MoE) model:

| Spec | Value |
|---|---|
| Total parameters | 35B |
| Active parameters per token | ~3B |
| VRAM (4-bit) | ~9 GB |
| Speed | Comparable to a 3B dense model |
| Quality | Significantly better than 14B dense models |

The MoE architecture means only 3B parameters activate per forward pass, so it runs at small-model speeds with large-model quality. This is the key advantage — you get 35B-class reasoning at 3B-class latency.

---

## Installation

### Prerequisites

- macOS 14+ (Sonoma or later)
- Apple Silicon Mac (M1/M2/M3/M4)
- Python 3.10+
- At least 16 GB unified memory (24 GB recommended)

### Install vllm-mlx

macOS ships with Python 3.9 which is too old. Use Python 3.10+ (check with `python3.13 --version` or `python3.12 --version`):

```bash
# Create a virtual environment with Python 3.10+
python3.13 -m venv ~/.venvs/vllm
source ~/.venvs/vllm/bin/activate

# Clone and install from source (recommended)
git clone https://github.com/waybarrios/vllm-mlx.git ~/Apps/vllm-mlx
cd ~/Apps/vllm-mlx
pip install -e .
```

If you prefer not to clone, you can also install directly via pip (requires Python 3.10+):

```bash
pip install vllm-mlx
```

### Verify installation

```bash
vllm-mlx --help
```

---

## Starting the server

```bash
# Activate the virtual environment
source ~/.venvs/vllm/bin/activate

# Start serving Qwen3.5-35B-A3B with tool calling enabled
vllm-mlx serve mlx-community/Qwen3.5-35B-A3B-4bit \
  --enable-auto-tool-choice \
  --tool-call-parser qwen \
  --host 0.0.0.0 \
  --port 8000
```

The first run downloads the model (~9 GB). Subsequent starts are near-instant.

### Important flags

| Flag | Purpose |
|---|---|
| `--enable-auto-tool-choice` | **Required** — enables function/tool calling support |
| `--tool-call-parser qwen` | **Required for Qwen models** — selects the correct tool call format |
| `--host 0.0.0.0` | Listen on all interfaces (default: localhost only) |
| `--port 8000` | API port (default: 8000) |
| `--max-model-len 8192` | Limit context length to save memory |
| `--continuous-batching` | Enable for multiple concurrent users |

### Verify it's running

```bash
curl http://localhost:8000/v1/models
```

You should see a JSON response listing the served model.

---

## Configuration

In your `.env` file:

```bash
# Switch to vllm-mlx backend
LLM_BACKEND=vllm
VLLM_HOST=http://localhost:8000
VLLM_MODEL=mlx-community/Qwen3.5-35B-A3B-4bit
```

That's it. All existing functionality — missions, tools, Slack, CLI — works identically. The provider abstraction in `src/agent/llm.js` handles the API format differences automatically.

### Multi-model routing

vllm-mlx serves **one model per process** (unlike Ollama which hot-swaps). For most setups, disable routing and use a single capable model:

```bash
# Leave these empty to disable routing (recommended for vllm-mlx)
FAST_MODEL=
SMART_MODEL=
```

If you need routing, you can run two vllm-mlx instances on different ports, but this requires enough memory for both models.

---

## Running with PM2

For production, uncomment the vllm process in `ecosystem.config.cjs`:

```javascript
{
  name: 'vllm',
  script: 'vllm-mlx',
  args: 'serve mlx-community/Qwen3.5-35B-A3B-4bit --enable-auto-tool-choice --tool-call-parser qwen --host 0.0.0.0 --port 8000',
  interpreter: 'none',
  autorestart: true,
  restart_delay: 5000,
  max_restarts: 5,
  watch: false,
}
```

Then:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

**Note:** Make sure the `vllm-mlx` binary is in your PATH, or use the full path to the venv binary:

```javascript
script: '/Users/you/.venvs/vllm/bin/vllm-mlx',
```

---

## Switching between backends

You can switch between Ollama and vllm-mlx at any time by changing `LLM_BACKEND` in `.env` and restarting Goose:

```bash
# Use Ollama (default)
LLM_BACKEND=ollama

# Use vllm-mlx
LLM_BACKEND=vllm
```

Only one backend needs to be running at a time. There's no need to have both Ollama and vllm-mlx running simultaneously.

---

## Troubleshooting

### "vllm-mlx unreachable"

1. Check the server is running: `curl http://localhost:8000/v1/models`
2. Verify `VLLM_HOST` in `.env` matches the port you started vllm on
3. Check vllm logs for startup errors

### Tool calling not working

Make sure you started vllm-mlx with both `--enable-auto-tool-choice` and `--tool-call-parser qwen` (for Qwen models). Without these flags, the model won't generate tool calls correctly.

### Out of memory

- Use `--max-model-len 4096` to reduce context window size
- Close other GPU-intensive apps
- Consider a smaller quantisation: `mlx-community/Qwen3.5-35B-A3B-8bit` uses more memory but gives better quality; `4bit` is the recommended balance

### Model download fails

The model downloads from Hugging Face on first run. If it fails:

```bash
# Install huggingface CLI
pip install huggingface-hub

# Download manually
huggingface-cli download mlx-community/Qwen3.5-35B-A3B-4bit
```

### Slow first response

vllm-mlx compiles the model on first load, which can take 30-60 seconds. Subsequent requests are fast. If using PM2, the model stays loaded between requests.

---

## Further reading

- [vllm-mlx GitHub](https://github.com/waybarrios/vllm-mlx)
- [MLX framework](https://github.com/ml-explore/mlx)
- [Qwen3.5 model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- [MLX Community models](https://huggingface.co/mlx-community)
- [Goose provider abstraction](../src/agent/llm.js)
