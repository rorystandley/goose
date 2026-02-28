# Goose Plugins

Plugins extend Goose with new tools without touching core source code. Each plugin exports a `tools` array using the same shape as built-in tools — Goose loads them automatically at startup.

---

## Two Loading Modes

| Mode | When to use | Requires npm? |
|---|---|---|
| **Local `plugins/` dir** | Personal tools, rapid prototyping | No |
| **npm package** | Shareable, publishable tools | Yes (for publishing) |

Both modes coexist. npm-sourced tools are loaded first; if a local plugin exports a tool with the same name as an already-loaded npm tool, the local one is skipped (with a warning).

---

## Plugin Interface

Every plugin — whether local or npm — must export a `tools` array:

```js
export const tools = [
  {
    name: 'my_tool',                           // snake_case, unique across all tools
    description: 'What this tool does.',       // shown to the LLM and in /goose help
    riskLevel: 'safe',                         // see Risk Levels below
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The input value' },
      },
      required: ['input'],
    },
    execute: async ({ input }) => {
      // Do the work. Return a string the LLM can read.
      return `Result: ${input}`;
    },
  },
];
```

### Risk Levels

| Value | Behaviour |
|---|---|
| `'safe'` | Runs automatically, no approval |
| `'moderate'` | Runs automatically, logged for review |
| `'dangerous'` | Pauses — user must Approve / Deny in Slack |

### Return Values

`execute` should return a string. For structured data, return a JSON string:

```js
execute: async ({ name }) => JSON.stringify({ found: true, name }),
```

---

## Option A — Local `plugins/` Directory

The simplest mode. No npm account, no linking, no config.

```
plugins/
  my-tool/
    index.js      ← must export `tools` array
    package.json  ← optional but recommended (makes it ready for npm later)
    store.js      ← optional persistence layer
```

Restart Goose — it scans `plugins/` on startup and loads every subdirectory that contains an `index.js`.

**To start:** copy `plugins/template/` and rename it:

```bash
cp -r plugins/template plugins/my-tool
# Edit plugins/my-tool/index.js and plugins/my-tool/package.json
```

Override the default directory with the `PLUGINS_DIR` env var if needed.

---

## Option B — npm Package

The right model for plugins you want to share or publish. Each plugin is a standalone directory with its own `package.json`, developed wherever you keep your projects.

### Naming Convention

Goose auto-discovers npm packages matching either pattern in `node_modules`:

| Pattern | Example |
|---|---|
| `@goose-plugins/*` | `@goose-plugins/twitter` |
| `goose-plugin-*` | `goose-plugin-github` |

No config required — install (or link) the package and restart.

### Plugin structure

```
my-plugin/
  index.js      ← export const tools = [...]
  store.js      ← optional persistence layer
  package.json  ← name must match the naming convention
```

**`package.json`:**

```json
{
  "name": "@goose-plugins/my-plugin",
  "version": "1.0.0",
  "type": "module",
  "description": "What this plugin does",
  "exports": {
    ".": "./index.js",
    "./store.js": "./store.js"
  },
  "keywords": ["goose", "goose-plugins"],
  "license": "MIT"
}
```

Include `"./store.js"` in `exports` only if you have a persistence layer that needs to be importable externally (e.g. for tests).

### Local development with `npm link`

Develop without publishing — changes are live on next Goose restart:

```bash
# 1. In your plugin directory — register it globally
cd path/to/my-plugin
npm link

# 2. In the goose directory — symlink it into node_modules
cd path/to/goose
npm link @goose-plugins/my-plugin

# 3. Restart Goose — auto-discovered via naming convention
node src/cli.js
```

To remove the link:

```bash
cd path/to/goose
npm unlink @goose-plugins/my-plugin
```

> **Tip:** If you move the plugin directory, the symlink breaks. Re-run `npm link` in the plugin directory then `npm link <name>` in the goose directory to fix it.

### Publishing to npm

```bash
cd path/to/my-plugin

# First time
npm publish --access public

# Updates
npm version patch   # or minor / major
npm publish
```

After publishing, anyone can install it:

```bash
npm install @goose-plugins/my-plugin
# Restart Goose — tools appear automatically
```

### Graduating a local plugin to npm

When a plugin started in `plugins/` is ready to become a proper npm package:

```bash
# 1. Move it out of the goose repo to its own directory
cp -r plugins/my-tool path/to/my-plugin

# 2. Update package.json with the correct @goose-plugins/ name, then link it
cd path/to/my-plugin && npm link
cd path/to/goose && npm link @goose-plugins/my-tool

# 3. Remove the local copy (or leave it — deduplication handles the overlap, npm version wins)
rm -rf plugins/my-tool
```

---

## Data Persistence

Plugins that need to store state between conversations should use a `store.js` module with a JSON file backend. See `@goose-tools/architecture` for a complete example:

- Load JSON on first access, default to empty structure
- Expose typed mutators (`addSystem`, `addRelationship`, etc.)
- Return deep copies from getters to prevent external mutation
- Use an env var for the file path so it's configurable

---

## Reference: `@goose-plugins/architecture`

The architecture plugin is the canonical example. It demonstrates:
- Multi-tool plugin with a shared persistence layer (`store.js`)
- Three diagram output formats (PlantUML, Mermaid, LikeC4)
- Defensive deep copies in store getters
- `exports` map exposing both `index.js` and `store.js`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Plugin not loaded | No `index.js` in the directory | Add `index.js` that exports `tools` |
| Plugin not loaded | `tools` is not an array | Check your export: `export const tools = [...]` |
| Tool appears twice | npm-linked AND local `plugins/` both present | Safe — deduplication keeps first (npm) version |
| `npm link` not working | ESM resolution issue | Ensure `"type": "module"` in plugin's `package.json` |
| Tool not visible in `/goose help` | Goose not restarted after adding plugin | Restart Goose — plugins load at startup only |
| Symlink broken | Plugin directory was moved | Re-run `npm link` in plugin dir, then `npm link <name>` in goose |
