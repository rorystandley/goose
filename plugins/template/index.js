/**
 * Goose plugin template
 *
 * Getting started:
 *   1. Copy this directory to a new location (inside plugins/ or its own repo)
 *   2. Rename the package in package.json — use @goose-tools/<name> for the npm namespace
 *   3. Add your tools below following the same shape
 *   4. Restart Goose — it will auto-discover the plugin
 *
 * Loading options:
 *   A) Local dev  — drop the directory inside plugins/  (no npm required)
 *   B) npm link   — cd <plugin-dir> && npm link && cd <goose-dir> && npm link @goose-tools/<name>
 *   C) Published  — npm install @goose-tools/<name>  (auto-discovered by naming convention)
 *
 * See docs/plugins.md for the full guide.
 */

// ---------------------------------------------------------------------------
// Example tool — replace with your own
// ---------------------------------------------------------------------------

const hello_world = {
  name: 'hello_world',
  description: 'A starter tool — replace with your own logic.',

  // Risk level controls whether Goose pauses for human approval before running:
  //   'safe'      — runs automatically, no approval needed
  //   'moderate'  — runs automatically, logged for review
  //   'dangerous' — pauses and asks the user to Approve / Deny
  riskLevel: 'safe',

  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Something to say',
      },
    },
    required: ['message'],
  },

  execute: async ({ message }) => {
    return `You said: ${message}`;
  },
};

// ---------------------------------------------------------------------------
// Export — standard interface expected by loadPlugins()
// ---------------------------------------------------------------------------

export const tools = [
  hello_world,
  // add more tools here
];
