import 'dotenv/config';
import path from 'path';

const required = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}. Check your .env file.`);
  }
}

function parsePositiveIntOrFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const config = Object.freeze({
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
  AGENT_NAME: process.env.AGENT_NAME || 'Goose',
  MAX_TOOL_ITERATIONS: parseInt(process.env.MAX_TOOL_ITERATIONS || '10', 10),
  REQUIRE_APPROVAL: process.env.REQUIRE_APPROVAL !== 'false',
  ALLOWED_PATHS: (process.env.ALLOWED_PATHS || '/Users').split(',').map(p => p.trim()),
  MEMORY_PATH: process.env.MEMORY_PATH || path.join(process.cwd(), 'data', 'memory.json'),
  MISSIONS_PATH: process.env.MISSIONS_PATH || path.join(process.cwd(), 'data', 'missions.json'),
  SCHEDULER_ALLOW_DANGEROUS: process.env.SCHEDULER_ALLOW_DANGEROUS === 'true',
  THOUGHTS_PATH: process.env.THOUGHTS_PATH || path.join(process.cwd(), 'data', 'thoughts.jsonl'),
  FACTS_PATH: process.env.FACTS_PATH || path.join(process.cwd(), 'data', 'facts.json'),
  PLUGINS_DIR: process.env.PLUGINS_DIR || path.join(process.cwd(), 'plugins'),
  MONITORS_PATH: process.env.MONITORS_PATH || path.join(process.cwd(), 'data', 'monitors.json'),
  MONITORS_ALLOW_DANGEROUS: process.env.MONITORS_ALLOW_DANGEROUS === 'true',
  KANBAN_PATH: process.env.KANBAN_PATH || path.join(process.cwd(), 'data', 'kanban.json'),
  KANBAN_POLL_INTERVAL: parseInt(process.env.KANBAN_POLL_INTERVAL || '60000', 10),
  WEB_ENABLED: process.env.WEB_ENABLED === 'true',
  WEB_PORT: parseInt(process.env.WEB_PORT || '3000', 10),
  // Multi-model routing — leave empty to always use OLLAMA_MODEL
  FAST_MODEL:    process.env.FAST_MODEL    || '',
  SMART_MODEL:   process.env.SMART_MODEL   || '',
  ROUTING_MODEL: process.env.ROUTING_MODEL || '',
  // LLM backend — 'ollama' (default) or 'vllm' (vllm-mlx, Apple Silicon optimised)
  LLM_BACKEND: process.env.LLM_BACKEND || 'ollama',
  VLLM_HOST: process.env.VLLM_HOST || 'http://localhost:8000',
  VLLM_MODEL: process.env.VLLM_MODEL || '',
  // Voice interface — requires: brew install sox whisper-cpp
  VOICE_WHISPER_MODEL: process.env.VOICE_WHISPER_MODEL || 'base.en',
  VOICE_TTS_BACKEND: process.env.VOICE_TTS_BACKEND || 'say',
  VOICE_MLX_TTS_URL: process.env.VOICE_MLX_TTS_URL || 'http://127.0.0.1:7860',
  VOICE_MLX_TTS_MODEL: process.env.VOICE_MLX_TTS_MODEL || 'mlx-community/Kokoro-82M-bf16',
  VOICE_MLX_TTS_VOICE: process.env.VOICE_MLX_TTS_VOICE || 'af_heart',
  VOICE_MLX_TTS_LANGUAGE: process.env.VOICE_MLX_TTS_LANGUAGE || 'a',
  VOICE_MLX_TTS_TIMEOUT_MS: parsePositiveIntOrFallback(process.env.VOICE_MLX_TTS_TIMEOUT_MS, 120000),
  // Search providers — add whichever key(s) you have; first configured one is used
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY || '',
  SERPER_API_KEY: process.env.SERPER_API_KEY || '',
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
});

export default config;
