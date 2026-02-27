/**
 * Returns the complete single-file HTML dashboard for the Goose web UI.
 * @param {string} agentName — from config.AGENT_NAME
 * @param {string} model     — from config.OLLAMA_MODEL
 */
export function getHtml(agentName, model) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      font-size: 20px;
      line-height: 1;
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
    #header .status-dot.busy { background: var(--orange); }
    #header .status-dot.error { background: var(--red); }

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
    #empty-state .empty-icon { font-size: 36px; opacity: 0.4; }
    #empty-state p { font-size: 13px; }

    /* ── Messages ────────────────────────────────────────────────── */
    .msg {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-width: 88%;
      animation: fadeIn 0.15s ease;
    }

    .msg.user { align-self: flex-end; }
    .msg.assistant { align-self: flex-start; }
    .msg.error { align-self: flex-start; }

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

    .tool-icon { font-size: 13px; }

    .tool-name {
      font-weight: 600;
      color: var(--blue);
      font-size: 12px;
    }

    .risk-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .risk-safe    { background: var(--green-dim);  color: var(--green);  border: 1px solid rgba(63,185,80,0.3); }
    .risk-moderate{ background: var(--yellow-dim); color: var(--yellow); border: 1px solid rgba(210,153,34,0.3); }
    .risk-dangerous{ background: var(--red-dim);   color: var(--red);    border: 1px solid rgba(248,81,73,0.3); }

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

    .approval-actions {
      display: flex;
      gap: 8px;
    }

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

    .btn-approve {
      background: var(--green);
      color: #000;
    }
    .btn-deny {
      background: var(--red);
      color: #fff;
    }

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

    .memory-actions {
      display: flex;
      gap: 6px;
    }

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
    <span class="logo">🪿</span>
    <div>
      <div class="title">${agentName}</div>
      <div class="subtitle">${model}</div>
    </div>
    <div class="spacer"></div>
    <div class="status-dot" id="status-dot"></div>
    <div class="context-badge" id="context-display">—</div>
  </header>

  <!-- ── Main: timeline + input ─────────────────────────────────── -->
  <main id="main">
    <div id="timeline">
      <div id="empty-state">
        <div class="empty-icon">🪿</div>
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
  const toolCards = new Map(); // toolName+timestamp → element

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

    const argsStr  = JSON.stringify(args, null, 2);
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

    // Collapsible args
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

    card.querySelector('.btn-approve').addEventListener('click', () => sendApproval(approvalId, true, card));
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
    if (data.requiresApproval) {
      appendApprovalCard(data);
    } else {
      appendToolCard(data);
    }
  });

  es.addEventListener('toolResult', e => {
    updateToolCard(JSON.parse(e.data));
  });

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

  // ── Init ─────────────────────────────────────────────────────────
  populateContexts();
  setStatus('idle');
  taskInput.focus();
</script>
</body>
</html>`;
}
