# Goose — Voice Interface

Voice mode is a hands-free push-to-talk interface. Press Enter to start recording, speak your task, press Enter again to stop — Goose transcribes the audio locally with `whisper-cli`, runs the task, and reads the response back with macOS `say`.

No new npm packages are required. Recording and transcription are delegated entirely to system tools.

---

## System requirements

| Tool | Purpose | Platform |
|---|---|---|
| `sox` | Microphone recording | macOS / Linux (`brew install sox`) |
| `whisper-cli` | Local speech-to-text transcription | installed by `brew install whisper-cpp` |
| `say` | Text-to-speech response playback | macOS built-in — zero install |

> **Note:** `say` is macOS-only. On other platforms Goose will complete the task and print the response but will not read it aloud — voice mode otherwise works normally.

---

## Quick start

```bash
# 1. Install system dependencies
#    Note: the Homebrew package is "whisper-cpp" but the binary is called "whisper-cli"
brew install sox whisper-cpp

# 2. Download the Whisper model (not bundled — must be fetched separately)
mkdir -p ~/.cache/whisper
curl -L -o ~/.cache/whisper/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# 3. Start voice mode
npm run voice
```

Press **Enter** to start recording, speak your task, press **Enter** again to stop. Goose will transcribe, think, and speak its response.

---

## Downloading the Whisper model

The `whisper-cpp` Homebrew formula does **not** bundle model files, and the `--download-model` flag was removed in v1.7+. You must download the model file manually.

### Option A — curl (recommended)

```bash
mkdir -p ~/.cache/whisper
curl -L -o ~/.cache/whisper/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Replace `base.en` with whichever model you want — see the [Available models](#available-models) table below for names.

### Option B — browser download

Download the `.bin` file from one of these sources and move it to `~/.cache/whisper/`:

- **HuggingFace:** https://huggingface.co/ggerganov/whisper.cpp/tree/main
- **GGML mirror:** https://ggml.ggerganov.com/

```bash
mkdir -p ~/.cache/whisper
mv ~/Downloads/ggml-base.en.bin ~/.cache/whisper/
```

### Model path resolution

Goose searches for the model in this order:

1. The value of `VOICE_WHISPER_MODEL` if it is an absolute path (e.g. `/custom/path/model.bin`)
2. `~/.cache/whisper/ggml-<name>.bin` — whisper-cpp default download location
3. `/opt/homebrew/share/whisper-cpp/models/ggml-<name>.bin` — Apple Silicon Homebrew
4. `/usr/local/share/whisper-cpp/models/ggml-<name>.bin` — Intel Homebrew

If no file is found, Goose prints an error with the download command and exits.

---

## Available models

| Model | Size | Speed | Accuracy |
|---|---|---|---|
| `tiny.en` | 75 MB | Fastest | Basic |
| `base.en` | 142 MB | Fast | Good — **default** |
| `small.en` | 466 MB | Moderate | Better |
| `medium.en` | 1.5 GB | Slow | High |
| `large` | 2.9 GB | Slowest | Best (multilingual) |

English-only models (`.en` suffix) are faster than the multilingual equivalents for English speech. `base.en` is the recommended starting point.

---

## Configuration

Set in `.env`:

```
# Whisper model name (or absolute path to a .bin file)
VOICE_WHISPER_MODEL=base.en
```

| Variable | Default | Description |
|---|---|---|
| `VOICE_WHISPER_MODEL` | `base.en` | Whisper model name to use, or an absolute path to a `.bin` file |

---

## Voice commands

| Spoken phrase | Action |
|---|---|
| `"clear memory"` | Clears the voice session conversation history |
| `Ctrl+C` | Exits voice mode |

Everything else is passed directly to the agent.

---

## Memory

Voice mode uses a persistent context keyed to the machine: `voice-<hostname>`. Conversation history survives restarts and carries across sessions — the same way CLI and Web memory works. Say `"clear memory"` or run `clearHistory('voice-<hostname>')` programmatically to reset it.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `zsh: command not found: whisper-cli` | Package not installed | Run `brew install whisper-cpp` — the binary is `whisper-cli`, not `whisper-cpp` |
| `Whisper model 'base.en' not found` | Model not downloaded | Download with `curl` or browser — see [Downloading the Whisper model](#downloading-the-whisper-model) |
| `sox not found` | sox not installed | `brew install sox` |
| `(nothing heard, try again)` | Silent recording or transcription returned empty | Speak louder, check microphone permissions in System Settings → Privacy → Microphone |
| Response not read aloud | Non-macOS platform | `say` is macOS-only; response is printed to terminal instead |
| Transcription is slow | Large model selected | Switch to `base.en` in `.env`: `VOICE_WHISPER_MODEL=base.en` |
| Transcription is inaccurate | `base.en` model | Download `small.en` (see above) then set `VOICE_WHISPER_MODEL=small.en` in `.env` |
| Microphone permission denied | macOS hasn't granted access | Go to System Settings → Privacy & Security → Microphone → enable Terminal (or your app) |

---

## Implementation reference

| File | Role |
|---|---|
| `src/voice.js` | Entry point — initialises tools, starts monitors, calls `runVoice()` |
| `src/interfaces/voice/index.js` | Push-to-talk REPL loop, approval callbacks, `waitForEnter()` |
| `src/interfaces/voice/stt.js` | `resolveModel()`, `startRecording()` (sox), `transcribe()` (whisper-cli) |
| `src/interfaces/voice/tts.js` | `speak()` — macOS `say` wrapper, silent on error |
| `src/config.js` | `VOICE_WHISPER_MODEL` |
| `src/__tests__/interfaces/voice.test.js` | Unit tests for TTS, STT, and model resolution |
