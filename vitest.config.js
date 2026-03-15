import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.js'],
    // Provide fake Slack credentials so config.js doesn't throw on import
    env: {
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_APP_TOKEN: 'xapp-test-token',
      SLACK_SIGNING_SECRET: 'test-signing-secret',
      OLLAMA_MODEL: 'test-model',
      AGENT_NAME: 'TestGoose',
      MAX_TOOL_ITERATIONS: '5',
      REQUIRE_APPROVAL: 'true',
      ALLOWED_PATHS: '/tmp,/private/tmp,/Users',
      LOG_LEVEL: 'error',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: [
        'src/interfaces/slack/**',  // Slack interface — no unit tests
        'src/interfaces/voice/index.js', // Interactive TTY voice runtime
        'src/interfaces/web/server.js',  // HTTP server bootstrap/integration wiring
        'src/interfaces/web/sse.js',     // SSE transport wiring (integration-tested)
        'src/kanban/**',                 // Kanban runtime store/watcher integration layer
        'src/index.js',             // Slack entry point
        'src/cli.js',               // CLI entry point
        'src/voice.js',             // Voice entry point
        'src/scheduler-runner.js',  // Standalone scheduler process entry
        'src/__tests__/**',
      ],
      thresholds: {
        lines: 70,
        functions: 75,
        branches: 60,
        statements: 70,
      },
    },
    clearMocks: true,
    restoreMocks: true,
  },
});
