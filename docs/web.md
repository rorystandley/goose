# Goose — Mission Control

Goose’s local web app is a React 19 dashboard built with Vite. It has nine dedicated views, a responsive sidebar, keyboard navigation, and live updates from the existing Node HTTP server. The cockpit design uses charcoal instrument panels, green telemetry accents, amber attention states, and an F-14 airframe illustration.

## Start the dashboard

Use Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run web
# Open http://localhost:3000
```

Installation builds the frontend automatically through `prepare`. `npm run web` and `npm run dev:web` also rebuild before starting the CLI and web server. `WEB_PORT` changes the HTTP port; `WEB_ENABLED=true` enables the dashboard alongside the Slack entry point. The HTTP server binds to `127.0.0.1`.

For a deployment that omits development dependencies, build with development dependencies first, retain `src/interfaces/web/dist/`, then prune dependencies. Do not run the build using an install that omits Vite.

## Views

| View | Purpose |
| --- | --- |
| Command centre | Real task counts, upcoming missions, active work, and attention states |
| Comms | Chat with Goose, inspect live tool calls, and approve or deny dangerous actions |
| Task board | Five workflow columns, search, creation/editing, output criteria, priority/tags, execution controls, results, and live task streams |
| Missions | Schedules in each mission’s timezone, latest outcome, verification, manual triggers, and linked context memory |
| Radar | Monitor states, targets, checks, values, cooldowns, and errors |
| Briefings | Audio playback, transcripts, recording metadata, and deletion |
| Memory | Select a stored context, inspect complete messages, refresh, or clear conversation history |
| Loadout | Installed plugins, descriptions, tool details, risk levels, and load failures |
| Systems | Read-only runtime, model routing, audio configuration, and connection status |

The navigation uses hash URLs such as `/#/missions`, so browser back/forward and reload work without server-side routing. Press **Cmd/Ctrl + K** to find a view. Small screens use a collapsible navigation panel; the task board scrolls horizontally while the page stays within the viewport. Focus indicators, semantic controls, native modal focus management, and reduced-motion support are included.

Counts and statuses come from the APIs; missing telemetry is shown as loading or unavailable, never a fabricated success. A resource failure has a retry action. The dashboard refreshes resources every 30 seconds and receives task, mission, monitor, audio, and approval events over SSE. The Refresh button fetches current data immediately. Connection loss is visible and pauses chat sending.

## Tasks and approvals

New tasks enter **Backlog**. Moving a task to **Ready** permits the existing server watcher to execute it automatically. **Run now** manually triggers a ready task. Running tasks cannot be edited or deleted. Finished or blocked tasks can be returned to Backlog. Task details retain acceptance criteria, results, verification evidence, and links to memory. A running task’s details subscribe to its live tool stream from the moment the dialog opens.

Dangerous chat tools prompt in Comms. Dangerous board tools prompt on the Task board, with an attention banner visible across views. Approvals remain visible across navigation. The server auto-denies unanswered requests after five minutes; the resolution event clears the UI, including decisions made in another connected browser. Auto-approval remains an explicit, unchecked-by-default task option.

SSE events are not replayed after a full page reload or a lost connection. Live chat/tool events shown in the browser are session-only, capped at 500 events; stored conversation history remains available in Memory. An already-pending approval is not recoverable by a newly opened browser and will time out if no existing client handles it.

## Conversation context

The existing `gooseContextId` localStorage key is preserved, keeping the same web conversation identity across upgrades and visits. A new browser profile gets a new ID. Selecting another context in Memory only changes the inspector; it does not switch the Comms session. Chat drafts and live events survive navigation between views. Clearing history removes that context’s conversation messages while keeping long-term facts.

## Frontend development

Run Goose’s web backend in one terminal, then Vite in another:

```bash
npm run web
npm run dev:ui
# Open http://localhost:5173
```

Vite proxies `/api`, `/assets`, and `/favicon.ico` to `127.0.0.1:3000`. Set `WEB_PORT` for the Vite command too if the backend uses another port. The browser bundle needs no CDN, remote fonts, or additional production server.

```bash
npm run build:web        # Build app.js and app.css for the Node server
npm run lint             # Includes JSX and React hook checks
npm test                 # Backend and frontend state/bootstrap tests
npx playwright install chromium
npm run test:web         # Build and test the production dashboard in Chromium
```

Browser tests use an isolated fixture server with in-memory data. They never import the agent, access local stores, execute missions, or invoke tools. Coverage includes all views, keyboard navigation, mobile overflow, task CRUD, chat approvals, request errors, memory links, and audio selection. CI installs Chromium and runs these tests.

## Architecture and design references

React with Vite suits this local interactive dashboard because Goose already provides routing, data APIs, and an SSE transport. Server rendering and another server framework would add runtime complexity without a requirement for public indexing or server-rendered pages. See [React’s existing-project integration guidance](https://react.dev/learn/add-react-to-an-existing-project).

The information hierarchy draws on [Linear’s 2026 interface refresh](https://linear.app/now/behind-the-latest-design-refresh): quieter navigation, predictable controls, and task-focused content. The overview-to-detail structure follows [Grafana dashboard guidance](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/). The F-14 treatment is an original visual theme, with operational status kept distinct from decorative aircraft graphics.

| File | Role |
| --- | --- |
| `src/interfaces/web/client/main.jsx` | App shell, navigation, command search, action feedback |
| `src/interfaces/web/client/views.jsx` | Dedicated workflow views |
| `src/interfaces/web/client/components.jsx` | Shared panels, states, approval cards, dialogs, airframe graphic |
| `src/interfaces/web/client/data.js` | API client, resource refresh, SSE state, formatting |
| `src/interfaces/web/client/styles.css` | Design tokens, cockpit theme, responsive layouts |
| `src/interfaces/web/public.js` | Escaped bootstrap and HTML shell |
| `src/interfaces/web/handlers.js` | Existing API routes and allowlisted built assets |
| `vite.config.js` | Development proxy and production bundle |
| `tests/web/` | Isolated browser fixtures and workflow tests |

## API reference

All routes use the same local server. JSON errors return `{ error: string }` with a 4xx/5xx status.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/events?contextId=<id>` | SSE stream; connect before submitting chat |
| POST | `/api/chat` | `{ task, contextId }`; returns 202, response arrives via SSE |
| POST | `/api/approve`, `/api/deny` | `{ approvalId, contextId }` |
| GET, DELETE | `/api/memory?contextId=<id>` | Inspect or clear history |
| GET | `/api/contexts` | Stored context IDs |
| GET, POST | `/api/kanban` | List or create tasks |
| PUT, DELETE | `/api/kanban/:id` | Edit/move or delete a non-running task |
| POST | `/api/kanban/:id/trigger` | Execute a ready task |
| GET | `/api/missions` | Mission schedules and state |
| POST | `/api/missions/:name/trigger` | Manual run; `{ startNew: true }` restarts a failed run |
| GET | `/api/monitors` | Monitor state |
| GET | `/api/audio` | Recording metadata and availability |
| GET | `/api/audio/:id/stream` | Play a file within configured audio directories |
| DELETE | `/api/audio/:id` | Remove recording metadata and its allowed file |
| GET | `/api/plugins` | Plugin and tool metadata |
| GET | `/api/system` | Runtime configuration |
