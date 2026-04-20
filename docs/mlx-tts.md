# MLX TTS Studio Integration

Goose voice mode speaks responses with macOS `say` by default, via `src/interfaces/voice/tts.js`. That is reliable and zero-install, but it sounds mechanical. [MLX TTS Studio](https://github.com/rorystandley/mlx-tts-studio) can provide a more natural local voice while keeping Goose's private/local design intact.

MLX TTS Studio is a standalone app and local HTTP service. Goose only depends on its public localhost API, not on its internal Python code. See the upstream README section [Using this from another local app](https://github.com/rorystandley/mlx-tts-studio#using-this-from-another-local-app) for the API contract.

## Why Use It

- Better spoken responses for `npm run voice`.
- A consistent local assistant voice for Goose.
- Audio versions of scheduled missions, morning briefings, monitor alerts, or long summaries.
- Local/private speech generation, matching Goose's local LLM and local Whisper setup.

## Recommended Presets

| Preset | Use |
|---|---|
| `Kokoro 82M bf16 - fast local` | Best supportable choice while Goose is also running a local LLM. |
| `Voxtral 4B TTS - high quality` | Higher-quality target when there is enough spare memory. |
| `KugelAudio 0 Open - best open-source` | Strict open-source experiment; heavy on a 24 GB Mac. |

Kokoro is the Goose default because it can run alongside a local Qwen/Ollama session with much less memory pressure than larger TTS models.

## Install MLX TTS Studio

```bash
git clone https://github.com/rorystandley/mlx-tts-studio.git ~/Apps/mlx-tts-studio
cd ~/Apps/mlx-tts-studio
uv sync
./run.sh
```

Open:

```text
http://127.0.0.1:7860
```

Use `Download/load selected model` before long Goose voice sessions. This pays the first Hugging Face download/load cost before Goose needs to speak.

## Run With pm2

The Goose `ecosystem.config.cjs` includes an optional `mlx-tts-studio` process. From the Goose repo:

```bash
pm2 start ecosystem.config.cjs --only mlx-tts-studio
pm2 save
```

By default it looks for MLX TTS Studio beside Goose at `../mlx-tts-studio`. If your clone is somewhere else:

```bash
MLX_TTS_STUDIO_PATH=/path/to/mlx-tts-studio pm2 start ecosystem.config.cjs --only mlx-tts-studio
pm2 save
```

Check it with:

```bash
curl -s http://127.0.0.1:7860/health
```

## Configure Goose

Enable the Goose integration in `.env`:

```dotenv
VOICE_TTS_BACKEND=mlx
VOICE_MLX_TTS_URL=http://127.0.0.1:7860
VOICE_MLX_TTS_MODEL=mlx-community/Kokoro-82M-bf16
VOICE_MLX_TTS_VOICE=af_heart
VOICE_MLX_TTS_LANGUAGE=a
VOICE_MLX_TTS_INSTRUCT=
VOICE_MLX_TTS_TEMPERATURE=
VOICE_MLX_TTS_TIMEOUT_MS=120000
```

Then start Goose voice mode:

```bash
npm run voice
```

## Integration Contract

The implementation keeps Goose's agent core untouched and changes only the TTS adapter:

1. `src/interfaces/voice/tts.js` checks `VOICE_TTS_BACKEND`.
2. When set to `mlx`, it calls `POST /synthesize` on MLX TTS Studio.
3. The service returns a local audio file path.
4. Goose plays the file with `afplay`.
5. If the service is offline, slow, or returns an error, Goose falls back to macOS `say`.

That gives Goose a graceful chain:

```text
MLX TTS Studio -> afplay -> say fallback
```

The Goose adapter uses `/synthesize` rather than `/v1/audio/speech` because both processes run on the same machine and a returned local file path is the simplest playback path.

## VoiceDesign Instructions

For Qwen3 VoiceDesign, set the model to `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`, leave `VOICE_MLX_TTS_VOICE` empty, set `VOICE_MLX_TTS_LANGUAGE=english`, and put the reusable voice description in `VOICE_MLX_TTS_INSTRUCT`.

Example:

```dotenv
VOICE_MLX_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16
VOICE_MLX_TTS_VOICE=
VOICE_MLX_TTS_LANGUAGE=english
VOICE_MLX_TTS_INSTRUCT=An original confident naval aviator wingman voice: warm, witty, steady under pressure, with a relaxed American accent, clean radio-style articulation, medium pitch, subtle rasp, and playful timing. Friendly and capable, like someone smiling while keeping the mission on track. Natural, human, conversational, not a celebrity imitation.
VOICE_MLX_TTS_TEMPERATURE=0.65
```

VoiceDesign conditions each generation from that instruction. It does not create a persistent speaker file in Goose, so keeping the instruction specific and consistent matters.

## Smoke Test

With MLX TTS Studio running, test the Goose TTS adapter directly:

```bash
node --input-type=module -e "import { speak } from './src/interfaces/voice/tts.js'; await speak('Goose voice test through Kokoro.');"
```

If that speaks, `npm run voice` should use the same output path after transcription and agent response generation.
