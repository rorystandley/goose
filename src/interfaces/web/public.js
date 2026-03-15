/**
 * Returns the complete single-file HTML dashboard for the Goose web UI.
 * @param {string} agentName        — from config.AGENT_NAME
 * @param {string} model            — from config.OLLAMA_MODEL
 * @param {number} kanbanPollInterval — from config.KANBAN_POLL_INTERVAL (ms)
 */
export function getHtml(agentName, model, kanbanPollInterval = 60000) {
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
  <title>${agentName} — Mission Control</title>
  <style>
    /* ── Design tokens ─────────────────────────────────────────── */
    :root {
      --bg:         #0d0d0d;
      --surface:    #161616;
      --surface-2:  #1e1e1e;
      --surface-3:  #252525;
      --border:     #2a2a2a;
      --border-2:   #333;
      --text:       #e8e8e8;
      --text-dim:   #6b6b6b;
      --text-muted: #444;
      --orange:     #f5a623;
      --orange-dim: rgba(245,166,35,0.12);
      --green:      #3fb950;
      --green-dim:  rgba(63,185,80,0.12);
      --yellow:     #d29922;
      --yellow-dim: rgba(210,153,34,0.12);
      --red:        #f85149;
      --red-dim:    rgba(248,81,73,0.12);
      --blue:       #58a6ff;
      --blue-dim:   rgba(88,166,255,0.12);
      --radius:     8px;
      --radius-sm:  5px;
      --font:       'SF Mono', 'Consolas', 'Liberation Mono', monospace;
      --sans:       -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Reset ─────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Layout ─────────────────────────────────────────────────── */
    #app {
      display: grid;
      grid-template-rows: 48px 1fr;
      grid-template-columns: 1fr 320px;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Header ─────────────────────────────────────────────────── */
    #header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    #header .logo {
      width: 24px;
      height: 24px;
      object-fit: contain;
      opacity: 0.95;
    }

    #header .title {
      font-weight: 600;
      color: var(--orange);
      font-size: 14px;
      letter-spacing: 0.02em;
    }

    #header .subtitle {
      color: var(--text-dim);
      font-size: 11px;
      font-family: var(--sans);
    }

    #header .spacer { flex: 1; }

    #header .context-badge {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      font-size: 11px;
      color: var(--text-dim);
    }

    #header .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      transition: background 0.3s;
    }
    #header .status-dot.busy  { background: var(--orange); }
    #header .status-dot.error { background: var(--red); }

    /* ── Tab bar ─────────────────────────────────────────────────── */
    .tab-bar {
      display: flex;
      gap: 2px;
      background: var(--surface-3);
      border-radius: var(--radius-sm);
      padding: 2px;
    }
    .tab {
      background: transparent;
      border: none;
      border-radius: 4px;
      color: var(--text-dim);
      font-family: var(--font);
      font-size: 12px;
      padding: 4px 14px;
      cursor: pointer;
      transition: color 0.15s, background 0.15s;
    }
    .tab:hover { color: var(--text); }
    .tab.active { background: var(--surface-2); color: var(--text); }

    /* ── Main panel (chat + stream) ─────────────────────────────── */
    #main {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-right: 1px solid var(--border);
    }

    #timeline {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      scroll-behavior: smooth;
    }

    #timeline::-webkit-scrollbar { width: 4px; }
    #timeline::-webkit-scrollbar-track { background: transparent; }
    #timeline::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 2px; }

    /* ── Empty state ─────────────────────────────────────────────── */
    #empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--text-muted);
      font-family: var(--sans);
    }
    #empty-state .empty-icon {
      width: 72px;
      height: 72px;
      object-fit: contain;
      opacity: 0.45;
    }
    #empty-state p { font-size: 13px; }

    /* ── Messages ────────────────────────────────────────────────── */
    .msg {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-width: 88%;
      animation: fadeIn 0.15s ease;
    }

    .msg.user      { align-self: flex-end; }
    .msg.assistant { align-self: flex-start; }
    .msg.error     { align-self: flex-start; }

    .msg-label {
      font-size: 10px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .msg.user .msg-label { text-align: right; }

    .msg-bubble {
      padding: 10px 14px;
      border-radius: var(--radius);
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .msg.user .msg-bubble {
      background: var(--orange-dim);
      border: 1px solid rgba(245,166,35,0.25);
      color: var(--text);
    }

    .msg.assistant .msg-bubble {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
    }

    .msg.error .msg-bubble {
      background: var(--red-dim);
      border: 1px solid rgba(248,81,73,0.3);
      color: var(--red);
    }

    /* ── Tool cards ──────────────────────────────────────────────── */
    .tool-card {
      align-self: flex-start;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 12px;
      width: 100%;
      max-width: 600px;
      animation: fadeIn 0.15s ease;
    }

    .tool-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .tool-icon  { font-size: 13px; }
    .tool-name  { font-weight: 600; color: var(--blue); font-size: 12px; }

    .risk-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .risk-safe     { background: var(--green-dim);  color: var(--green);  border: 1px solid rgba(63,185,80,0.3); }
    .risk-moderate { background: var(--yellow-dim); color: var(--yellow); border: 1px solid rgba(210,153,34,0.3); }
    .risk-dangerous{ background: var(--red-dim);    color: var(--red);    border: 1px solid rgba(248,81,73,0.3); }

    .tool-args {
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 7px 10px;
      font-size: 11px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
      overflow: hidden;
      max-height: 80px;
      cursor: pointer;
      position: relative;
    }
    .tool-args.expanded { max-height: none; }
    .tool-args-toggle {
      font-size: 10px;
      color: var(--text-muted);
      cursor: pointer;
      margin-top: 4px;
      display: none;
    }
    .tool-args-toggle.visible { display: block; }

    .tool-result {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-dim);
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* ── Approval card ───────────────────────────────────────────── */
    .approval-card {
      align-self: flex-start;
      width: 100%;
      max-width: 600px;
      background: var(--surface-2);
      border: 1px solid rgba(248,81,73,0.4);
      border-radius: var(--radius);
      padding: 14px;
      animation: fadeIn 0.15s ease;
    }

    .approval-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--red);
      font-size: 12px;
      margin-bottom: 8px;
    }

    .approval-args {
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      font-size: 11px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 10px;
      max-height: 120px;
      overflow-y: auto;
    }

    .approval-actions { display: flex; gap: 8px; }

    .btn-approve, .btn-deny {
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: var(--radius-sm);
      font-family: var(--font);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
    }
    .btn-approve:hover { opacity: 0.85; transform: translateY(-1px); }
    .btn-deny:hover    { opacity: 0.85; transform: translateY(-1px); }
    .btn-approve:disabled, .btn-deny:disabled { opacity: 0.4; cursor: default; transform: none; }
    .btn-approve { background: var(--green); color: #000; }
    .btn-deny    { background: var(--red);   color: #fff; }

    .approval-resolved {
      font-size: 11px;
      color: var(--text-dim);
      margin-top: 8px;
      font-style: italic;
    }

    /* ── Input bar ───────────────────────────────────────────────── */
    #input-bar {
      padding: 12px 16px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    #task-input {
      flex: 1;
      background: var(--surface-2);
      border: 1px solid var(--border-2);
      border-radius: var(--radius);
      padding: 10px 14px;
      color: var(--text);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.5;
      resize: none;
      min-height: 42px;
      max-height: 140px;
      outline: none;
      transition: border-color 0.15s;
    }
    #task-input:focus { border-color: var(--orange); }
    #task-input::placeholder { color: var(--text-muted); }

    #send-btn {
      background: var(--orange);
      color: #000;
      border: none;
      border-radius: var(--radius);
      padding: 10px 16px;
      font-family: var(--font);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.15s, transform 0.1s;
      height: 42px;
    }
    #send-btn:hover:not(:disabled) { opacity: 0.85; transform: translateY(-1px); }
    #send-btn:disabled { opacity: 0.4; cursor: default; transform: none; }

    /* ── Thinking indicator ──────────────────────────────────────── */
    .thinking {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-dim);
      font-size: 12px;
      padding: 6px 0;
      animation: fadeIn 0.15s ease;
    }
    .dots span {
      display: inline-block;
      width: 4px; height: 4px;
      border-radius: 50%;
      background: var(--text-dim);
      animation: dot 1.2s infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.2s; }
    .dots span:nth-child(3) { animation-delay: 0.4s; }

    /* ── Memory panel ────────────────────────────────────────────── */
    #memory-panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--surface);
    }

    #memory-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    #memory-header h2 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-dim);
      font-family: var(--sans);
    }

    #context-select {
      background: var(--surface-2);
      border: 1px solid var(--border-2);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font);
      font-size: 11px;
      padding: 5px 8px;
      outline: none;
      cursor: pointer;
    }
    #context-select option { background: var(--surface-2); }

    .memory-actions { display: flex; gap: 6px; }

    .btn-sm {
      background: var(--surface-3);
      border: 1px solid var(--border-2);
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      font-family: var(--font);
      font-size: 11px;
      padding: 4px 10px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .btn-sm:hover { color: var(--text); border-color: var(--text-dim); }
    .btn-sm.danger:hover { color: var(--red); border-color: var(--red); }

    #memory-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #memory-list::-webkit-scrollbar { width: 3px; }
    #memory-list::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 2px; }

    .mem-entry {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      font-size: 11px;
      animation: fadeIn 0.1s ease;
    }

    .mem-role {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 3px;
    }
    .mem-role.user      { color: var(--orange); }
    .mem-role.assistant { color: var(--blue); }

    .mem-content {
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 60px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mem-empty {
      color: var(--text-muted);
      text-align: center;
      padding: 20px;
      font-family: var(--sans);
      font-size: 12px;
    }

    /* ── Kanban view ─────────────────────────────────────────────── */
    #kanban-view {
      display: none;
      flex-direction: column;
      grid-column: 1 / -1;
      overflow: hidden;
    }

    #kanban-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .kb-toolbar-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-dim);
    }

    #kb-next-check {
      font-size: 11px;
      color: var(--text-muted);
    }

    #kanban-toolbar .spacer { flex: 1; }

    .kb-toolbar-btn {
      background: var(--surface-3);
      border: 1px solid var(--border-2);
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      font-family: var(--font);
      font-size: 11px;
      padding: 4px 10px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .kb-toolbar-btn:hover { color: var(--text); border-color: var(--text-dim); }
    .kb-toolbar-btn.paused { color: var(--orange); border-color: rgba(245,166,35,0.4); }

    /* ── Kanban board grid ───────────────────────────────────────── */
    #kanban-board {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      padding: 16px;
      flex: 1;
      overflow-x: auto;
      overflow-y: hidden;
      min-height: 0;
    }

    .kb-col {
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      min-height: 0;
      overflow: hidden;
    }

    .kb-col-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-dim);
      font-family: var(--sans);
      flex-shrink: 0;
    }
    .kb-col[data-status="ready"]       .kb-col-header { color: var(--blue); }
    .kb-col[data-status="in-progress"] .kb-col-header { color: var(--orange); }
    .kb-col[data-status="done"]        .kb-col-header { color: var(--green); }

    .kb-count {
      background: var(--surface-3);
      border-radius: 10px;
      padding: 1px 7px;
      font-size: 10px;
      color: var(--text-muted);
      font-family: var(--font);
    }

    .kb-cards {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 40px;
    }
    .kb-cards::-webkit-scrollbar { width: 3px; }
    .kb-cards::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 2px; }
    .kb-cards.drag-over {
      background: var(--surface-2);
      outline: 1px dashed var(--border-2);
      outline-offset: -2px;
      border-radius: var(--radius-sm);
    }

    /* ── Kanban card ─────────────────────────────────────────────── */
    .kb-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      cursor: grab;
      animation: fadeIn 0.15s ease;
      transition: border-color 0.15s;
    }
    .kb-card:hover { border-color: var(--border-2); }
    .kb-card:active { cursor: grabbing; }
    .kb-card.dragging { opacity: 0.4; cursor: grabbing; }
    .kb-card[data-status="in-progress"] {
      cursor: default;
      border-color: rgba(245,166,35,0.3);
    }

    .kb-card-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 7px;
      line-height: 1.4;
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }

    .kb-card-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .kb-priority {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 6px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .kb-priority-urgent { background: var(--red-dim);    color: var(--red);    border: 1px solid rgba(248,81,73,0.3); }
    .kb-priority-high   { background: var(--orange-dim); color: var(--orange); border: 1px solid rgba(245,166,35,0.3); }
    .kb-priority-medium { background: var(--blue-dim);   color: var(--blue);   border: 1px solid rgba(88,166,255,0.3); }
    .kb-priority-low    { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }

    .kb-tag {
      font-size: 9px;
      color: var(--text-muted);
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 1px 5px;
    }

    .kb-time-dim {
      font-size: 10px;
      color: var(--text-muted);
      margin-left: auto;
      white-space: nowrap;
    }

    .kb-live-dot {
      display: inline-block;
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--orange);
      flex-shrink: 0;
      margin-top: 4px;
      animation: kbpulse 1.5s ease infinite;
    }

    @keyframes kbpulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.25; }
    }

    .kb-card-actions {
      display: none;
      gap: 4px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .kb-card:hover .kb-card-actions { display: flex; }

    .kb-action-btn {
      background: var(--surface-3);
      border: 1px solid var(--border-2);
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      font-family: var(--font);
      font-size: 10px;
      padding: 2px 8px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .kb-action-btn:hover        { color: var(--text); border-color: var(--text-dim); }
    .kb-action-btn.danger:hover { color: var(--red);  border-color: var(--red); }
    .kb-action-btn.primary      { color: var(--orange); border-color: rgba(245,166,35,0.4); }
    .kb-action-btn.primary:hover { border-color: var(--orange); }

    .kb-card-body {
      display: none;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }
    .kb-card.expanded .kb-card-body { display: block; }

    .kb-card-desc {
      font-size: 11px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 8px;
      line-height: 1.6;
    }

    .kb-result-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--green);
      margin-bottom: 4px;
    }

    .kb-card-result {
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      font-size: 11px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 200px;
      overflow-y: auto;
    }

    /* ── Add task form ────────────────────────────────────────────── */
    .kb-add-trigger {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 11px;
      cursor: pointer;
      transition: color 0.15s;
      flex-shrink: 0;
    }
    .kb-add-trigger:hover { color: var(--text-dim); }

    .kb-add-form {
      padding: 8px;
      border-top: 1px solid var(--border);
      display: none;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    .kb-add-form.open { display: flex; }

    .kb-form-input, .kb-form-textarea, .kb-form-select {
      background: var(--surface-3);
      border: 1px solid var(--border-2);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font);
      font-size: 11px;
      padding: 6px 8px;
      outline: none;
      width: 100%;
    }
    .kb-form-input:focus, .kb-form-textarea:focus { border-color: var(--orange); }
    .kb-form-input::placeholder, .kb-form-textarea::placeholder { color: var(--text-muted); }
    .kb-form-textarea { resize: vertical; min-height: 60px; }
    .kb-form-select { cursor: pointer; }
    .kb-form-select option { background: var(--surface-3); }

    .kb-form-row { display: flex; gap: 6px; }
    .kb-form-row .kb-form-select { flex: 0 0 90px; }
    .kb-form-row .kb-form-input  { flex: 1; }
    .kb-form-actions { display: flex; gap: 6px; }

    /* ── Inline edit form ────────────────────────────────────────── */
    .kb-edit-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* ── allowDangerous checkbox ─────────────────────────────────── */
    .kb-form-check {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      color: var(--text-dim);
      cursor: pointer;
      user-select: none;
    }
    .kb-form-check input[type="checkbox"] { accent-color: var(--orange); cursor: pointer; }

    /* ── Tab badge (approval pending indicator) ──────────────────── */
    .tab[data-badge]::after {
      content: attr(data-badge);
      background: var(--red);
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      border-radius: 8px;
      padding: 0 4px;
      margin-left: 5px;
      line-height: 1.6;
      vertical-align: middle;
    }

    /* ── Kanban approval card (inside in-progress card) ──────────── */
    .kb-approval {
      margin-top: 8px;
      padding: 10px;
      background: var(--red-dim);
      border: 1px solid rgba(248,81,73,0.35);
      border-radius: var(--radius-sm);
      animation: fadeIn 0.15s ease;
    }

    .kb-approval-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--red);
      margin-bottom: 6px;
    }

    .kb-approval-args {
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 5px 8px;
      font-size: 10px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 80px;
      overflow-y: auto;
      margin-bottom: 8px;
    }

    .kb-approval-actions { display: flex; gap: 6px; }

    .kb-btn-approve, .kb-btn-deny {
      flex: 1;
      padding: 5px;
      border: none;
      border-radius: var(--radius-sm);
      font-family: var(--font);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .kb-btn-approve:hover, .kb-btn-deny:hover { opacity: 0.85; }
    .kb-btn-approve { background: var(--green); color: #000; }
    .kb-btn-deny    { background: var(--red);   color: #fff; }

    /* ── Animations ──────────────────────────────────────────────── */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes dot {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30%            { transform: translateY(-4px); opacity: 1; }
    }
  </style>
</head>
<body>
<div id="app">

  <!-- ── Header ─────────────────────────────────────────────────── -->
  <header id="header">
    <img class="logo" src="/assets/goose.png" alt="Goose logo">
    <div>
      <div class="title">${agentName}</div>
      <div class="subtitle">${model}</div>
    </div>
    <div class="tab-bar">
      <button class="tab active" data-tab="chat">Chat</button>
      <button class="tab" data-tab="kanban">Kanban</button>
    </div>
    <div class="spacer"></div>
    <div class="status-dot" id="status-dot"></div>
    <div class="context-badge" id="context-display">—</div>
  </header>

  <!-- ── Main: timeline + input ─────────────────────────────────── -->
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

  <!-- ── Memory panel ───────────────────────────────────────────── -->
  <aside id="memory-panel">
    <div id="memory-header">
      <h2>Memory</h2>
      <select id="context-select"><option value="">— select context —</option></select>
      <div class="memory-actions">
        <button class="btn-sm" id="refresh-btn">Refresh</button>
        <button class="btn-sm danger" id="clear-btn">Clear</button>
      </div>
    </div>
    <div id="memory-list"><div class="mem-empty">Select a context to inspect memory.</div></div>
  </aside>

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

</div>

<script>
  // ── Context ID — stable per browser session ──────────────────────
  function generateId() {
    return 'web-' + Math.random().toString(36).slice(2, 10);
  }
  let contextId = localStorage.getItem('gooseContextId');
  if (!contextId) {
    contextId = generateId();
    localStorage.setItem('gooseContextId', contextId);
  }
  document.getElementById('context-display').textContent = contextId;

  // ── DOM refs ─────────────────────────────────────────────────────
  const timeline   = document.getElementById('timeline');
  const emptyState = document.getElementById('empty-state');
  const taskInput  = document.getElementById('task-input');
  const sendBtn    = document.getElementById('send-btn');
  const statusDot  = document.getElementById('status-dot');
  const memoryList = document.getElementById('memory-list');
  const ctxSelect  = document.getElementById('context-select');

  // ── State ────────────────────────────────────────────────────────
  let thinking = null;
  let isBusy   = false;
  const toolCards = new Map();

  // ── Status indicator ────────────────────────────────────────────
  function setStatus(state) {
    statusDot.className = 'status-dot' + (state === 'idle' ? '' : ' ' + state);
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function hideEmpty() {
    if (emptyState && emptyState.parentNode) emptyState.remove();
  }

  function scrollBottom() {
    requestAnimationFrame(() => { timeline.scrollTop = timeline.scrollHeight; });
  }

  function setBusy(busy) {
    isBusy = busy;
    sendBtn.disabled = busy;
    setStatus(busy ? 'busy' : 'idle');
    if (busy) {
      thinking = document.createElement('div');
      thinking.className = 'thinking';
      thinking.innerHTML = '<span>Goose is thinking</span><span class="dots"><span></span><span></span><span></span></span>';
      timeline.appendChild(thinking);
      scrollBottom();
    } else {
      if (thinking) { thinking.remove(); thinking = null; }
    }
  }

  // ── Append user message ──────────────────────────────────────────
  function appendUser(text) {
    hideEmpty();
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = \`<div class="msg-label">You</div><div class="msg-bubble">\${escHtml(text)}</div>\`;
    timeline.appendChild(el);
    scrollBottom();
  }

  // ── Append assistant response ────────────────────────────────────
  function appendAssistant(text) {
    if (thinking) { thinking.remove(); thinking = null; }
    const el = document.createElement('div');
    el.className = 'msg assistant';
    el.innerHTML = \`<div class="msg-label">Goose</div><div class="msg-bubble">\${escHtml(text)}</div>\`;
    timeline.appendChild(el);
    scrollBottom();
  }

  // ── Append error ─────────────────────────────────────────────────
  function appendError(text) {
    if (thinking) { thinking.remove(); thinking = null; }
    const el = document.createElement('div');
    el.className = 'msg error';
    el.innerHTML = \`<div class="msg-label">Error</div><div class="msg-bubble">\${escHtml(text)}</div>\`;
    timeline.appendChild(el);
    scrollBottom();
  }

  // ── Tool card ────────────────────────────────────────────────────
  function appendToolCard(data) {
    hideEmpty();
    if (thinking) { thinking.remove(); thinking = null; }

    const { toolName, args, riskLevel = 'safe' } = data;
    const key = toolName + '-' + Date.now();
    const argsStr   = JSON.stringify(args, null, 2);
    const riskClass = 'risk-' + riskLevel;
    const riskLabel = riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1);

    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.key = key;
    card.innerHTML = \`
      <div class="tool-card-header">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">\${escHtml(toolName)}</span>
        <span class="risk-badge \${riskClass}">\${riskLabel}</span>
      </div>
      <div class="tool-args" id="args-\${key}">\${escHtml(argsStr)}</div>
      <div class="tool-args-toggle" id="toggle-\${key}">▼ Show more</div>
    \`;
    timeline.appendChild(card);
    toolCards.set(toolName, card);

    const argsEl   = card.querySelector('#args-' + key);
    const toggleEl = card.querySelector('#toggle-' + key);
    requestAnimationFrame(() => {
      if (argsEl.scrollHeight > argsEl.clientHeight + 4) {
        toggleEl.classList.add('visible');
        toggleEl.addEventListener('click', () => {
          const expanded = argsEl.classList.toggle('expanded');
          toggleEl.textContent = expanded ? '▲ Show less' : '▼ Show more';
        });
      }
    });

    scrollBottom();
    return card;
  }

  // ── Update tool card with result ─────────────────────────────────
  function updateToolCard(data) {
    const { toolName, result } = data;
    const card = toolCards.get(toolName);
    if (!card) return;

    let resultEl = card.querySelector('.tool-result');
    if (!resultEl) {
      resultEl = document.createElement('div');
      resultEl.className = 'tool-result';
      card.appendChild(resultEl);
    }
    resultEl.textContent = result;
    scrollBottom();
  }

  // ── Approval card ────────────────────────────────────────────────
  function appendApprovalCard(data) {
    hideEmpty();
    if (thinking) { thinking.remove(); thinking = null; }

    const { toolName, args, approvalId } = data;
    const argsStr = JSON.stringify(args, null, 2);

    const card = document.createElement('div');
    card.className = 'approval-card';
    card.dataset.approvalId = approvalId;
    card.innerHTML = \`
      <div class="approval-title">
        <span>⚠️</span>
        <span>Dangerous tool: \${escHtml(toolName)}</span>
      </div>
      <pre class="approval-args">\${escHtml(argsStr)}</pre>
      <div class="approval-actions">
        <button class="btn-approve" data-id="\${approvalId}">✓ Approve</button>
        <button class="btn-deny"    data-id="\${approvalId}">✕ Deny</button>
      </div>
      <div class="approval-resolved" style="display:none"></div>
    \`;

    card.querySelector('.btn-approve').addEventListener('click', () => sendApproval(approvalId, true,  card));
    card.querySelector('.btn-deny').addEventListener('click',    () => sendApproval(approvalId, false, card));

    timeline.appendChild(card);
    scrollBottom();
  }

  async function sendApproval(approvalId, approved, card) {
    const endpoint = approved ? '/api/approve' : '/api/deny';
    card.querySelector('.btn-approve').disabled = true;
    card.querySelector('.btn-deny').disabled    = true;

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, contextId }),
    });

    const resolvedEl = card.querySelector('.approval-resolved');
    resolvedEl.style.display = 'block';
    resolvedEl.textContent   = approved ? '✓ Approved — continuing…' : '✕ Denied — skipped.';
  }

  // ── HTML escape ──────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── SSE subscription ─────────────────────────────────────────────
  const es = new EventSource('/api/events?contextId=' + encodeURIComponent(contextId));

  es.addEventListener('toolCall', e => {
    const data = JSON.parse(e.data);
    if (data.requiresApproval) appendApprovalCard(data);
    else appendToolCard(data);
  });

  es.addEventListener('toolResult',    e => updateToolCard(JSON.parse(e.data)));

  es.addEventListener('agentResponse', e => {
    const { content } = JSON.parse(e.data);
    appendAssistant(content);
    setBusy(false);
    loadMemory(contextId);
  });

  es.addEventListener('agentError', e => {
    const { message } = JSON.parse(e.data);
    appendError(message);
    setBusy(false);
    setStatus('error');
    setTimeout(() => setStatus('idle'), 3000);
  });

  es.onerror = () => setStatus('error');

  // ── Send message ─────────────────────────────────────────────────
  async function sendTask(task) {
    if (!task.trim() || isBusy) return;
    appendUser(task);
    setBusy(true);
    taskInput.style.height = '42px';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, contextId }),
      });
      if (!res.ok) {
        setBusy(false);
        appendError('Failed to send message. Is Goose running?');
      }
    } catch {
      setBusy(false);
      appendError('Network error — could not reach Goose.');
    }
  }

  document.getElementById('task-input').addEventListener('input', function() {
    this.style.height = '42px';
    this.style.height = Math.min(this.scrollHeight, 140) + 'px';
  });

  document.getElementById('task-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = taskInput.value.trim();
      taskInput.value = '';
      sendTask(val);
    }
  });

  document.getElementById('send-btn').addEventListener('click', () => {
    const val = taskInput.value.trim();
    taskInput.value = '';
    sendTask(val);
  });

  // ── Memory inspector ─────────────────────────────────────────────
  async function loadMemory(ctxId) {
    if (!ctxId) { memoryList.innerHTML = '<div class="mem-empty">Select a context to inspect memory.</div>'; return; }
    try {
      const res  = await fetch('/api/memory?contextId=' + encodeURIComponent(ctxId));
      const data = await res.json();
      renderMemory(data.messages || []);
    } catch {
      memoryList.innerHTML = '<div class="mem-empty">Failed to load memory.</div>';
    }
  }

  function renderMemory(messages) {
    if (!messages.length) {
      memoryList.innerHTML = '<div class="mem-empty">No memory for this context.</div>';
      return;
    }
    memoryList.innerHTML = messages.map(m => \`
      <div class="mem-entry">
        <div class="mem-role \${escHtml(m.role)}">\${escHtml(m.role)}</div>
        <div class="mem-content">\${escHtml(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))}</div>
      </div>
    \`).join('');
  }

  async function populateContexts() {
    try {
      const res  = await fetch('/api/contexts');
      const data = await res.json();
      const ids  = data.contextIds || [];
      ctxSelect.innerHTML = '<option value="">— select context —</option>' +
        ids.map(id => \`<option value="\${escHtml(id)}" \${id === contextId ? 'selected' : ''}>\${escHtml(id)}</option>\`).join('');
      if (ids.includes(contextId)) loadMemory(contextId);
    } catch { /* ignore */ }
  }

  ctxSelect.addEventListener('change', () => loadMemory(ctxSelect.value));

  document.getElementById('refresh-btn').addEventListener('click', () => {
    populateContexts();
    loadMemory(ctxSelect.value || contextId);
  });

  document.getElementById('clear-btn').addEventListener('click', async () => {
    const target = ctxSelect.value || contextId;
    if (!target) return;
    await fetch('/api/memory?contextId=' + encodeURIComponent(target), { method: 'DELETE' });
    loadMemory(target);
  });

  // ─────────────────────────────────────────────────────────────────
  // ── Kanban Board ─────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────

  const KANBAN_POLL_INTERVAL = ${kanbanPollInterval};
  let kanbanTasks          = [];
  let nextCheckAt          = Date.now() + KANBAN_POLL_INTERVAL;
  let watcherPaused        = false;
  const kanbanPendingApprovals = new Map(); // taskId → { approvalId, toolName, args, riskLevel }
  let dragTaskId    = null;

  // ── Tab switching ─────────────────────────────────────────────────
  function switchTab(tab) {
    const isKanban = tab === 'kanban';
    document.getElementById('main').style.display         = isKanban ? 'none' : 'flex';
    document.getElementById('memory-panel').style.display = isKanban ? 'none' : 'flex';
    document.getElementById('kanban-view').style.display  = isKanban ? 'flex' : 'none';
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (isKanban) loadKanban();
  }

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ── Fetch tasks from server ───────────────────────────────────────
  async function loadKanban() {
    try {
      const res = await fetch('/api/kanban');
      const data = await res.json();
      kanbanTasks = data.tasks || [];
      renderKanban();
    } catch { /* ignore */ }
  }

  // ── Render the full board ─────────────────────────────────────────
  function renderKanban() {
    for (const status of ['backlog', 'ready', 'in-progress', 'done']) {
      const cardsEl = document.getElementById('cards-' + status);
      const countEl = document.getElementById('count-' + status);
      if (!cardsEl || !countEl) continue;

      const tasks = kanbanTasks.filter(t => t.status === status);
      countEl.textContent = tasks.length;

      // Preserve which cards are expanded
      const expanded = new Set();
      cardsEl.querySelectorAll('.kb-card.expanded').forEach(el => expanded.add(el.dataset.id));

      cardsEl.innerHTML = '';
      for (const task of tasks) {
        const card = buildCard(task);
        if (expanded.has(task.id)) card.classList.add('expanded');
        cardsEl.appendChild(card);
      }
    }
  }

  // ── Build a single card DOM element ───────────────────────────────
  function buildCard(task) {
    const card = document.createElement('div');
    card.className = 'kb-card';
    card.dataset.id     = task.id;
    card.dataset.status = task.status;

    const isInProgress = task.status === 'in-progress';
    const isDone       = task.status === 'done';

    card.draggable = !isInProgress;

    // Title
    const titleEl = document.createElement('div');
    titleEl.className = 'kb-card-title';
    if (isInProgress) {
      const dot = document.createElement('span');
      dot.className = 'kb-live-dot';
      titleEl.appendChild(dot);
    }
    titleEl.appendChild(document.createTextNode(task.title));

    // Meta (priority + tags + time)
    const metaEl = document.createElement('div');
    metaEl.className = 'kb-card-meta';

    const prioEl = document.createElement('span');
    prioEl.className = 'kb-priority kb-priority-' + task.priority;
    prioEl.textContent = task.priority;
    metaEl.appendChild(prioEl);

    (task.tags || []).forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'kb-tag';
      tagEl.textContent = tag;
      metaEl.appendChild(tagEl);
    });

    if (isDone && task.completedAt) {
      const timeEl = document.createElement('span');
      timeEl.className = 'kb-time-dim';
      timeEl.textContent = formatTimeAgo(task.completedAt);
      metaEl.appendChild(timeEl);
    }

    // Action buttons
    const actionsEl = document.createElement('div');
    actionsEl.className = 'kb-card-actions';

    function addBtn(label, action, cls) {
      const btn = document.createElement('button');
      btn.className = 'kb-action-btn' + (cls ? ' ' + cls : '');
      btn.textContent = label;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        handleCardAction(action, task.id, task.contextId);
      });
      actionsEl.appendChild(btn);
    }

    if (task.status === 'backlog') {
      addBtn('→ Ready',   'promote');
      addBtn('Edit',      'edit');
      addBtn('✕',        'delete', 'danger');
    } else if (task.status === 'ready') {
      addBtn('← Backlog', 'demote');
      addBtn('▶ Now',    'trigger', 'primary');
      addBtn('Edit',      'edit');
      addBtn('✕',        'delete', 'danger');
    } else if (isInProgress) {
      addBtn('👁 View Live', 'view-live');
    } else if (isDone) {
      addBtn('↩ Reopen',  'reopen');
      addBtn('✕',        'delete', 'danger');
    }

    // Expandable body
    const bodyEl = document.createElement('div');
    bodyEl.className = 'kb-card-body';

    if (task.description) {
      const descEl = document.createElement('div');
      descEl.className = 'kb-card-desc';
      descEl.textContent = task.description;
      bodyEl.appendChild(descEl);
    }

    if (isDone && task.result) {
      const lbl = document.createElement('div');
      lbl.className = 'kb-result-label';
      lbl.textContent = 'Result';
      const res = document.createElement('div');
      res.className = 'kb-card-result';
      res.textContent = task.result.length > 2000 ? task.result.slice(0, 2000) + '…' : task.result;
      bodyEl.appendChild(lbl);
      bodyEl.appendChild(res);
    }

    card.appendChild(titleEl);
    card.appendChild(metaEl);

    // Approval UI — shown when this in-progress task has a pending dangerous-tool request
    if (isInProgress && kanbanPendingApprovals.has(task.id)) {
      const approval = kanbanPendingApprovals.get(task.id);

      const approvalEl = document.createElement('div');
      approvalEl.className = 'kb-approval';

      const approvalTitle = document.createElement('div');
      approvalTitle.className = 'kb-approval-title';
      approvalTitle.innerHTML = '\u26a0\ufe0f <strong>' + approval.toolName + '</strong>';
      approvalEl.appendChild(approvalTitle);

      const approvalArgs = document.createElement('div');
      approvalArgs.className = 'kb-approval-args';
      const argsText = JSON.stringify(approval.args, null, 2);
      approvalArgs.textContent = argsText.length > 300 ? argsText.slice(0, 300) + '…' : argsText;
      approvalEl.appendChild(approvalArgs);

      const approvalActions = document.createElement('div');
      approvalActions.className = 'kb-approval-actions';

      const approveBtn = document.createElement('button');
      approveBtn.className = 'kb-btn-approve';
      approveBtn.textContent = '✓ Approve';
      approveBtn.addEventListener('click', e => {
        e.stopPropagation();
        sendKanbanApproval(approval.approvalId, true);
      });

      const denyBtn = document.createElement('button');
      denyBtn.className = 'kb-btn-deny';
      denyBtn.textContent = '✕ Deny';
      denyBtn.addEventListener('click', e => {
        e.stopPropagation();
        sendKanbanApproval(approval.approvalId, false);
      });

      approvalActions.appendChild(approveBtn);
      approvalActions.appendChild(denyBtn);
      approvalEl.appendChild(approvalActions);

      card.appendChild(approvalEl);
    }

    card.appendChild(actionsEl);
    card.appendChild(bodyEl);

    // Click to expand/collapse
    card.addEventListener('click', e => {
      if (e.target.closest('.kb-action-btn')) return;
      card.classList.toggle('expanded');
    });

    // Drag events (in-progress cards are not draggable)
    if (!isInProgress) {
      card.addEventListener('dragstart', e => {
        dragTaskId = task.id;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        dragTaskId = null;
        card.classList.remove('dragging');
        document.querySelectorAll('.kb-cards').forEach(c => c.classList.remove('drag-over'));
      });
    }

    return card;
  }

  // ── Drop-zone rules: which columns a status can be dragged to ────
  const DRAG_RULES = {
    'backlog':     ['ready'],
    'ready':       ['backlog'],
    'in-progress': [],
    'done':        ['backlog'],
  };

  document.querySelectorAll('.kb-cards').forEach(cardsEl => {
    const colStatus = cardsEl.closest('.kb-col').dataset.status;

    cardsEl.addEventListener('dragover', e => {
      if (!dragTaskId) return;
      const task = kanbanTasks.find(t => t.id === dragTaskId);
      if (!task) return;
      if ((DRAG_RULES[task.status] || []).includes(colStatus)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cardsEl.classList.add('drag-over');
      }
    });

    cardsEl.addEventListener('dragleave', e => {
      if (!cardsEl.contains(e.relatedTarget)) cardsEl.classList.remove('drag-over');
    });

    cardsEl.addEventListener('drop', async e => {
      e.preventDefault();
      cardsEl.classList.remove('drag-over');
      if (!dragTaskId) return;
      const id = dragTaskId;
      dragTaskId = null;
      await moveTask(id, colStatus);
    });
  });

  // ── Card action dispatch ──────────────────────────────────────────
  async function handleCardAction(action, taskId, ctxId) {
    switch (action) {
      case 'promote':   await moveTask(taskId, 'ready');  break;
      case 'demote':    await moveTask(taskId, 'backlog'); break;
      case 'reopen':    await moveTask(taskId, 'backlog'); break;
      case 'trigger':   await triggerKanbanTask(taskId);  break;
      case 'edit':      showEditCard(taskId);              break;
      case 'delete':    await deleteKanbanTask(taskId);   break;
      case 'view-live': viewLive(ctxId);                  break;
    }
  }

  async function moveTask(taskId, newStatus) {
    const patch = { status: newStatus };
    if (newStatus === 'backlog') {
      Object.assign(patch, { startedAt: null, completedAt: null, contextId: null, result: null });
    }
    try {
      await fetch('/api/kanban/' + encodeURIComponent(taskId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch { /* SSE will sync */ }
  }

  async function triggerKanbanTask(taskId) {
    try {
      await fetch('/api/kanban/' + encodeURIComponent(taskId) + '/trigger', { method: 'POST' });
    } catch { /* ignore */ }
  }

  async function deleteKanbanTask(taskId) {
    if (!confirm('Delete this task?')) return;
    try {
      await fetch('/api/kanban/' + encodeURIComponent(taskId), { method: 'DELETE' });
    } catch { /* ignore */ }
  }

  function viewLive(ctxId) {
    switchTab('chat');
    if (ctxId) {
      populateContexts().then(() => {
        ctxSelect.value = ctxId;
        loadMemory(ctxId);
      });
    }
  }

  // ── Inline card edit ──────────────────────────────────────────────
  function showEditCard(taskId) {
    const task = kanbanTasks.find(t => t.id === taskId);
    if (!task) return;
    const cardEl = document.querySelector('.kb-card[data-id="' + taskId + '"]');
    if (!cardEl) return;

    cardEl.draggable = false;
    cardEl.innerHTML = '';
    cardEl.classList.remove('expanded');

    const form = document.createElement('div');
    form.className = 'kb-edit-form';

    const titleInput = document.createElement('input');
    titleInput.className = 'kb-form-input';
    titleInput.value = task.title;
    titleInput.placeholder = 'Task title…';

    const descTextarea = document.createElement('textarea');
    descTextarea.className = 'kb-form-textarea';
    descTextarea.value = task.description || '';
    descTextarea.placeholder = 'Description…';

    const prioritySelect = document.createElement('select');
    prioritySelect.className = 'kb-form-select';
    ['low', 'medium', 'high', 'urgent'].forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      opt.selected = task.priority === p;
      prioritySelect.appendChild(opt);
    });

    const tagsInput = document.createElement('input');
    tagsInput.className = 'kb-form-input';
    tagsInput.value = (task.tags || []).join(', ');
    tagsInput.placeholder = 'Tags (comma-separated)';

    const formRow = document.createElement('div');
    formRow.className = 'kb-form-row';
    formRow.appendChild(prioritySelect);
    formRow.appendChild(tagsInput);

    const allowDangerousLabel = document.createElement('label');
    allowDangerousLabel.className = 'kb-form-check';
    const allowDangerousCheck = document.createElement('input');
    allowDangerousCheck.type    = 'checkbox';
    allowDangerousCheck.checked = task.allowDangerous || false;
    allowDangerousLabel.appendChild(allowDangerousCheck);
    allowDangerousLabel.appendChild(document.createTextNode(' Allow dangerous tools (auto-approve)'));

    const saveBtn   = document.createElement('button');
    saveBtn.className = 'kb-action-btn primary';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'kb-action-btn';
    cancelBtn.textContent = 'Cancel';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'kb-form-actions';
    actionsRow.appendChild(saveBtn);
    actionsRow.appendChild(cancelBtn);

    form.appendChild(titleInput);
    form.appendChild(descTextarea);
    form.appendChild(formRow);
    form.appendChild(allowDangerousLabel);
    form.appendChild(actionsRow);
    cardEl.appendChild(form);
    titleInput.focus();
    titleInput.select();

    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
      try {
        await fetch('/api/kanban/' + encodeURIComponent(taskId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description:    descTextarea.value.trim(),
            priority:       prioritySelect.value,
            tags,
            allowDangerous: allowDangerousCheck.checked,
          }),
        });
      } catch { renderKanban(); }
    });

    cancelBtn.addEventListener('click', () => renderKanban());
  }

  // ── Add task form ─────────────────────────────────────────────────
  const addTrigger = document.getElementById('kb-add-trigger');
  const addForm    = document.getElementById('kb-add-form');

  addTrigger.addEventListener('click', () => {
    const isOpen = addForm.classList.toggle('open');
    if (isOpen) document.getElementById('kb-title').focus();
  });

  document.getElementById('kb-cancel-btn').addEventListener('click', () => {
    addForm.classList.remove('open');
    clearAddForm();
  });

  document.getElementById('kb-submit-btn').addEventListener('click', async () => {
    const title = document.getElementById('kb-title').value.trim();
    if (!title) { document.getElementById('kb-title').focus(); return; }
    const tags = document.getElementById('kb-tags').value
      .split(',').map(t => t.trim()).filter(Boolean);
    try {
      await fetch('/api/kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description:    document.getElementById('kb-desc').value.trim(),
          priority:       document.getElementById('kb-priority').value,
          tags,
          allowDangerous: document.getElementById('kb-allow-dangerous').checked,
        }),
      });
      addForm.classList.remove('open');
      clearAddForm();
    } catch { /* ignore */ }
  });

  function clearAddForm() {
    document.getElementById('kb-title').value           = '';
    document.getElementById('kb-desc').value            = '';
    document.getElementById('kb-priority').value        = 'medium';
    document.getElementById('kb-tags').value            = '';
    document.getElementById('kb-allow-dangerous').checked = false;
  }

  // ── Watcher controls ─────────────────────────────────────────────
  const pauseBtn = document.getElementById('kb-pause-btn');
  const checkBtn = document.getElementById('kb-check-btn');

  pauseBtn.addEventListener('click', () => {
    watcherPaused = !watcherPaused;
    pauseBtn.textContent = watcherPaused ? '▶ Resume' : '⏸ Pause';
    pauseBtn.classList.toggle('paused', watcherPaused);
  });

  checkBtn.addEventListener('click', () => {
    fetch('/api/kanban').then(r => r.json()).then(d => {
      kanbanTasks = d.tasks || [];
      renderKanban();
    }).catch(() => {});
  });

  // ── Countdown timer ───────────────────────────────────────────────
  function updateCountdown() {
    const el = document.getElementById('kb-next-check');
    if (!el) return;
    const rem = Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000));
    el.textContent = watcherPaused ? 'Watcher paused' : 'Next check in ' + rem + 's';
  }
  setInterval(updateCountdown, 1000);
  updateCountdown();

  // ── Format relative time ──────────────────────────────────────────
  function formatTimeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  // ── SSE: board updates broadcast to all clients ───────────────────
  es.addEventListener('kanbanUpdate', e => {
    const data = JSON.parse(e.data);
    kanbanTasks = data.tasks || [];
    nextCheckAt = Date.now() + KANBAN_POLL_INTERVAL;
    if (document.getElementById('kanban-view').style.display !== 'none') {
      renderKanban();
    }
  });

  // ── SSE: dangerous-tool approval needed for a kanban task ────────
  es.addEventListener('kanbanApproval', e => {
    const data = JSON.parse(e.data);
    kanbanPendingApprovals.set(data.taskId, data);
    // Badge the Kanban tab so the user notices
    const kanbanTab = document.querySelector('.tab[data-tab="kanban"]');
    if (kanbanTab) kanbanTab.dataset.badge = '!';
    // Re-render the board if it's visible so the approval card appears
    if (document.getElementById('kanban-view').style.display !== 'none') {
      renderKanban();
    }
  });

  // ── Send an approval / denial for a kanban-triggered tool ────────
  async function sendKanbanApproval(approvalId, approved) {
    const endpoint = approved ? '/api/approve' : '/api/deny';
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId }),
      });
    } catch { /* ignore network errors */ }

    // Remove this approval from the pending map
    for (const [taskId, data] of kanbanPendingApprovals) {
      if (data.approvalId === approvalId) {
        kanbanPendingApprovals.delete(taskId);
        break;
      }
    }

    // Clear the tab badge if nothing else is pending
    if (kanbanPendingApprovals.size === 0) {
      const kanbanTab = document.querySelector('.tab[data-tab="kanban"]');
      if (kanbanTab) delete kanbanTab.dataset.badge;
    }

    renderKanban();
  }

  // ── Init ─────────────────────────────────────────────────────────
  populateContexts();
  setStatus('idle');
  taskInput.focus();
</script>
</body>
</html>`;
}
