import 'dotenv/config';

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

const config = Object.freeze({
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
  AGENT_NAME: process.env.AGENT_NAME || 'Goose',
  MAX_TOOL_ITERATIONS: parseInt(process.env.MAX_TOOL_ITERATIONS || '10', 10),
  REQUIRE_APPROVAL: process.env.REQUIRE_APPROVAL !== 'false',
  MEMORY_DB_PATH: process.env.MEMORY_DB_PATH || '../../data/memory.db',
  ALLOWED_PATHS: (process.env.ALLOWED_PATHS || '/Users').split(',').map(p => p.trim()),
  // Search providers — add whichever key(s) you have; first configured one is used
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY || '',
  SERPER_API_KEY: process.env.SERPER_API_KEY || '',
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
});

export default config;
