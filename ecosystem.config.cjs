const path = require('node:path');

const rootDir = __dirname;
const appsDir = path.resolve(rootDir, '..');
const mlxTtsStudioPath = process.env.MLX_TTS_STUDIO_PATH
  || path.join(appsDir, 'mlx-tts-studio');
const vllmMlxBin = process.env.VLLM_MLX_BIN
  || '/Users/rorystandley/.venvs/vllm/bin/vllm-mlx';
const vllmModel = process.env.VLLM_MODEL || 'mlx-community/Qwen3-14B-4bit';

module.exports = {
  apps: [
    {
      name: 'goose',
      cwd: rootDir,
      script: './src/index.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
    },
    {
      name: 'goose-scheduler',
      cwd: rootDir,
      script: './src/scheduler-runner.js',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
    },
    {
      name: 'mlx-tts-studio',
      cwd: mlxTtsStudioPath,
      script: './run.sh',
      interpreter: 'bash',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
      env: {
        GRADIO_SERVER_NAME: '127.0.0.1',
        GRADIO_SERVER_PORT: '7860',
        DEFAULT_TTS_PRESET_LABEL: 'Kokoro 82M bf16 - fast local',
      },
    },
    // vllm-mlx inference server (Apple Silicon optimised)
    // Comment out if using Ollama instead
    {
      name: 'vllm',
      script: vllmMlxBin,
      args: `serve ${vllmModel} --enable-auto-tool-choice --tool-call-parser qwen --host 0.0.0.0 --port 8000`,
      interpreter: 'none',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 5,
      watch: false,
    },
  ],
};
