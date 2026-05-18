/**
 * Returns the HTML shell for the Goose web UI.
 *
 * The shell links to /app.css and /app.js (served as static files by handlers.js)
 * and injects per-session config via an inline window.__GOOSE bootstrap.
 *
 * @param {string} agentName        — from config.AGENT_NAME
 * @param {string} model            — from config.OLLAMA_MODEL
 * @param {number} kanbanPollInterval — from config.KANBAN_POLL_INTERVAL (ms)
 */
function escAttr(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function getHtml(agentName, model, kanbanPollInterval = 60000) {
  const bootstrap = JSON.stringify({
    agentName,
    model,
    kanbanPollInterval,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="manifest" href="/assets/site.webmanifest">
  <link rel="stylesheet" href="/app.css">
  <title>${escAttr(agentName)} — Mission Control</title>
</head>
<body>
<div id="app">

  <!-- ── Header ─────────────────────────────────────────────────── -->
  <header id="header">
    <img class="logo" src="/assets/goose.png" alt="Goose logo">
    <div class="title">${escAttr(agentName)}</div>
    <div class="header-stats">
      <span class="header-model">${escAttr(model)}</span>
      <span class="header-sep">·</span>
      <span class="header-stat-label">tts</span><span id="ops-sys-tts">—</span>
      <span class="header-sep">·</span>
      <span class="header-stat-label">up</span><span id="ops-sys-uptime">—</span>
    </div>
    <div class="spacer"></div>
    <div class="status-dot" id="status-dot"></div>
    <div class="context-badge" id="context-display">—</div>
  </header>

  <!-- ── Right panel: chat + memory stacked ─────────────────────── -->
  <div id="right-panel">

    <!-- ── Chat: timeline + input ──────────────────────────────── -->
    <main id="main">
      <div id="timeline">
        <div id="empty-state">
          <img class="empty-icon" src="/assets/goose.png" alt="" aria-hidden="true">
          <p>Talk to me, Goose.</p>
        </div>
      </div>

      <div id="input-bar">
        <textarea
          id="task-input"
          placeholder="Ask Goose anything…"
          rows="1"
          autocomplete="off"
          spellcheck="true"
        ></textarea>
        <button id="send-btn">Send ↑</button>
      </div>
    </main>

    <!-- ── Memory panel ──────────────────────────────────────────── -->
    <aside id="memory-panel">
      <div id="memory-header">
        <select id="context-select"><option value="">— context —</option></select>
        <button class="btn-sm" id="refresh-btn">↺</button>
        <button class="btn-sm danger" id="clear-btn">✕</button>
      </div>
      <div id="memory-list"><div class="mem-empty">Select a context to inspect memory.</div></div>
    </aside>

  </div>

  <!-- ── Kanban view ────────────────────────────────────────────── -->
  <div id="kanban-view">
    <div id="kanban-toolbar">
      <span class="kb-toolbar-title">Board</span>
      <span id="kb-next-check">—</span>
      <div class="spacer"></div>
      <button class="kb-toolbar-btn" id="kb-pause-btn">⏸ Pause</button>
      <button class="kb-toolbar-btn" id="kb-check-btn">↺ Refresh</button>
    </div>
    <div id="kanban-board">
      <div class="kb-col" data-status="backlog">
        <div class="kb-col-header">Backlog <span class="kb-count" id="count-backlog">0</span></div>
        <div class="kb-cards" id="cards-backlog"></div>
        <div class="kb-add-trigger" id="kb-add-trigger">+ Add task</div>
        <div class="kb-add-form" id="kb-add-form">
          <input  class="kb-form-input"    id="kb-title"    placeholder="Task title…">
          <textarea class="kb-form-textarea" id="kb-desc"   placeholder="Describe what Goose should do…"></textarea>
          <div class="kb-form-row">
            <select class="kb-form-select" id="kb-priority">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <input class="kb-form-input" id="kb-tags" placeholder="Tags (comma-separated)">
          </div>
          <label class="kb-form-check">
            <input type="checkbox" id="kb-allow-dangerous">
            Allow dangerous tools (auto-approve)
          </label>
          <div class="kb-form-actions">
            <button class="kb-action-btn primary" id="kb-submit-btn">Add to Backlog</button>
            <button class="kb-action-btn"         id="kb-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>
      <div class="kb-col" data-status="ready">
        <div class="kb-col-header">Ready <span class="kb-count" id="count-ready">0</span></div>
        <div class="kb-cards" id="cards-ready"></div>
      </div>
      <div class="kb-col" data-status="in-progress">
        <div class="kb-col-header">In Progress <span class="kb-count" id="count-in-progress">0</span></div>
        <div class="kb-cards" id="cards-in-progress"></div>
      </div>
      <div class="kb-col" data-status="done">
        <div class="kb-col-header">Done <span class="kb-count" id="count-done">0</span></div>
        <div class="kb-cards" id="cards-done"></div>
      </div>
    </div>
  </div>

  <!-- ── Ops view (Mission Operator dashboard) ──────────────────── -->
  <div id="ops-view">
    <div id="ops-grid">

      <!-- Audio library tile -->
      <section class="ops-tile ops-audio">
        <div class="ops-section-label">◀ AUDIO LIBRARY ▶
          <span class="ops-section-count" id="ops-audio-count">0</span>
        </div>
        <div class="ops-audio-player">
          <audio id="ops-audio-player" controls preload="none"></audio>
          <div class="ops-audio-now-playing" id="ops-audio-now">Select a briefing to play.</div>
        </div>
        <div class="ops-audio-list" id="ops-audio-list">
          <div class="ops-empty">No audio briefings yet.</div>
        </div>
      </section>

      <!-- Missions tile -->
      <section class="ops-tile ops-missions">
        <div class="ops-section-label">◀ MISSIONS ▶
          <span class="ops-section-count" id="ops-missions-count">0</span>
        </div>
        <div class="ops-missions-list" id="ops-missions-list">
          <div class="ops-empty">No missions configured.</div>
        </div>
      </section>

      <!-- Monitors tile -->
      <section class="ops-tile ops-monitors">
        <div class="ops-section-label">◀ MONITORS ▶
          <span class="ops-section-count" id="ops-monitors-count">0</span>
        </div>
        <div class="ops-monitors-list" id="ops-monitors-list">
          <div class="ops-empty">No monitors configured.</div>
        </div>
      </section>

      <!-- Plugins tile -->
      <section class="ops-tile ops-plugins">
        <div class="ops-section-label">◀ PLUGINS ▶
          <span class="ops-section-count" id="ops-plugins-count">0</span>
        </div>
        <div class="ops-plugins-list" id="ops-plugins-list">
          <div class="ops-empty">No plugins installed.</div>
        </div>
      </section>

    </div>
  </div>

</div>

<script>window.__GOOSE = ${bootstrap};</script>
<script src="/app.js"></script>
</body>
</html>`;
}
