module.exports = {
  apps: [
    {
      name: 'goose',
      script: './src/index.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
    },
    {
      name: 'goose-scheduler',
      script: './src/scheduler-runner.js',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
    },
    // vllm-mlx inference server (Apple Silicon optimised)
    // Only needed when LLM_BACKEND=vllm — comment out if using Ollama
    // {
    //   name: 'vllm',
    //   script: 'vllm-mlx',
    //   args: 'serve mlx-community/Qwen3-14B-4bit --enable-auto-tool-choice --tool-call-parser qwen --host 0.0.0.0 --port 8000',
    //   interpreter: 'none',
    //   autorestart: true,
    //   restart_delay: 5000,
    //   max_restarts: 5,
    //   watch: false,
    // },
  ],
};
