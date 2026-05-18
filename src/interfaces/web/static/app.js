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
    el.innerHTML = `<div class="msg-label">You</div><div class="msg-bubble">${escHtml(text)}</div>`;
    timeline.appendChild(el);
    scrollBottom();
  }

  // ── Append assistant response ────────────────────────────────────
  function appendAssistant(text) {
    if (thinking) { thinking.remove(); thinking = null; }
    const el = document.createElement('div');
    el.className = 'msg assistant';
    el.innerHTML = `<div class="msg-label">Goose</div><div class="msg-bubble">${escHtml(text)}</div>`;
    timeline.appendChild(el);
    scrollBottom();
  }

  // ── Append error ─────────────────────────────────────────────────
  function appendError(text) {
    if (thinking) { thinking.remove(); thinking = null; }
    const el = document.createElement('div');
    el.className = 'msg error';
    el.innerHTML = `<div class="msg-label">Error</div><div class="msg-bubble">${escHtml(text)}</div>`;
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
    card.innerHTML = `
      <div class="tool-card-header">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">${escHtml(toolName)}</span>
        <span class="risk-badge ${riskClass}">${riskLabel}</span>
      </div>
      <div class="tool-args" id="args-${key}">${escHtml(argsStr)}</div>
      <div class="tool-args-toggle" id="toggle-${key}">▼ Show more</div>
    `;
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
    card.innerHTML = `
      <div class="approval-title">
        <span>⚠️</span>
        <span>Dangerous tool: ${escHtml(toolName)}</span>
      </div>
      <pre class="approval-args">${escHtml(argsStr)}</pre>
      <div class="approval-actions">
        <button class="btn-approve" data-id="${approvalId}">✓ Approve</button>
        <button class="btn-deny"    data-id="${approvalId}">✕ Deny</button>
      </div>
      <div class="approval-resolved" style="display:none"></div>
    `;

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
    memoryList.innerHTML = messages.map(m => `
      <div class="mem-entry">
        <div class="mem-role ${escHtml(m.role)}">${escHtml(m.role)}</div>
        <div class="mem-content">${escHtml(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))}</div>
      </div>
    `).join('');
  }

  async function populateContexts() {
    try {
      const res  = await fetch('/api/contexts');
      const data = await res.json();
      const ids  = data.contextIds || [];
      ctxSelect.innerHTML = '<option value="">— select context —</option>' +
        ids.map(id => `<option value="${escHtml(id)}" ${id === contextId ? 'selected' : ''}>${escHtml(id)}</option>`).join('');
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

  const KANBAN_POLL_INTERVAL = window.__GOOSE?.kanbanPollInterval ?? 60000;
  let kanbanTasks          = [];
  let nextCheckAt          = Date.now() + KANBAN_POLL_INTERVAL;
  let watcherPaused        = false;
  const kanbanPendingApprovals = new Map(); // taskId → { approvalId, toolName, args, riskLevel }
  let dragTaskId    = null;


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
    renderKanban();
  });

  // ── SSE: dangerous-tool approval needed for a kanban task ────────
  es.addEventListener('kanbanApproval', e => {
    const data = JSON.parse(e.data);
    kanbanPendingApprovals.set(data.taskId, data);
    renderKanban();
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

    renderKanban();
  }

  // =================================================================
  // ── OPS TAB — Mission Operator Dashboard ─────────────────────────
  // =================================================================
  // Tile state, fetched lazily on tab activation and updated via SSE.
  let opsState = {
    audio: [],
    missions: [],
    monitors: [],
    plugins: [],
    system: null,
    activeAudioId: null,
  };
  let opsUptimeTimer = null;

  // ── Formatters ───────────────────────────────────────────────────
  function formatRelative(iso) {
    if (!iso) return '—';
    const now = Date.now();
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    const diff = now - t;
    const abs  = Math.abs(diff);
    const past = diff >= 0;
    const units = [
      ['y', 31536000000], ['mo', 2592000000], ['d', 86400000],
      ['h', 3600000],     ['m', 60000],        ['s', 1000],
    ];
    for (const [label, ms] of units) {
      if (abs >= ms) {
        const v = Math.floor(abs / ms);
        return past ? `${v}${label} ago` : `in ${v}${label}`;
      }
    }
    return past ? 'just now' : 'soon';
  }

  function formatDuration(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 60000)}m`;
  }

  function formatUptime(seconds) {
    if (seconds == null) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function ledClass(status) {
    if (status === 'running' || status === 'cooldown') return 'led on orange pulse';
    if (status === 'failed' || status === 'triggered') return 'led on red';
    if (status === 'completed' || status === 'ok')     return 'led on green';
    return 'led off';
  }

  // ── Audio tile ───────────────────────────────────────────────────
  function renderAudio() {
    const list = document.getElementById('ops-audio-list');
    document.getElementById('ops-audio-count').textContent = opsState.audio.length;
    if (opsState.audio.length === 0) {
      list.innerHTML = '<div class="ops-empty">No audio briefings yet.</div>';
      return;
    }
    list.innerHTML = '';
    for (const a of opsState.audio) {
      const row = document.createElement('div');
      row.className = 'ops-audio-row' + (a.id === opsState.activeAudioId ? ' active' : '') + (a.missing ? ' missing' : '');
      const source = (a.source || 'ad-hoc').toUpperCase();
      const dur    = a.duration ? `${a.duration.toFixed(1)}s` : '—';
      const text   = a.text ? escHtml(a.text) : '<em>(no transcript)</em>';
      const attrib = a.missionName
        ? `mission · ${escHtml(a.missionName)}`
        : a.monitorName
          ? `monitor · ${escHtml(a.monitorName)}`
          : a.contextId
            ? escHtml(a.contextId)
            : '—';
      row.innerHTML = `
        <div class="ops-audio-row-head">
          <span class="ops-audio-source ops-audio-source-${source.toLowerCase()}">${source}</span>
          <span class="ops-audio-attrib">${attrib}</span>
          <span class="ops-audio-when">${formatRelative(a.createdAt)} · ${dur}</span>
          <span class="ops-audio-actions">
            <button class="ops-btn ops-btn-play"   data-id="${a.id}" ${a.missing || !a.playable ? 'disabled' : ''}>▶</button>
            <button class="ops-btn ops-btn-delete" data-id="${a.id}" title="Delete">✕</button>
          </span>
        </div>
        <div class="ops-audio-text">${text}</div>
        ${a.missing ? '<div class="ops-audio-flag">(file removed from disk)</div>' : ''}
        ${!a.missing && !a.playable ? '<div class="ops-audio-flag">(AUDIO_OUTPUT_DIRS not configured — cannot play)</div>' : ''}
      `;
      list.appendChild(row);
    }

    list.querySelectorAll('.ops-btn-play').forEach(btn => {
      btn.addEventListener('click', () => playAudio(btn.dataset.id));
    });
    list.querySelectorAll('.ops-btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteAudio(btn.dataset.id));
    });
  }

  function playAudio(id) {
    const entry = opsState.audio.find(a => a.id === id);
    if (!entry) return;
    opsState.activeAudioId = id;
    const player = document.getElementById('ops-audio-player');
    player.src = `/api/audio/${encodeURIComponent(id)}/stream`;
    player.play().catch(() => { /* user can hit play manually */ });
    document.getElementById('ops-audio-now').textContent =
      `▶ ${entry.missionName || entry.monitorName || 'briefing'} — ${entry.text?.slice(0, 80) || ''}`;
    renderAudio();
  }

  async function deleteAudio(id) {
    if (!confirm('Delete this audio briefing? The .wav file will be removed.')) return;
    // Optimistic
    opsState.audio = opsState.audio.filter(a => a.id !== id);
    renderAudio();
    try {
      await fetch(`/api/audio/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch { /* SSE will reconcile on next fetch */ }
  }

  // ── Missions tile ─────────────────────────────────────────────────
  function renderMissions() {
    const list = document.getElementById('ops-missions-list');
    document.getElementById('ops-missions-count').textContent = opsState.missions.length;
    if (opsState.missions.length === 0) {
      list.innerHTML = '<div class="ops-empty">No missions configured.</div>';
      return;
    }
    list.innerHTML = '';
    for (const m of opsState.missions) {
      const row = document.createElement('div');
      row.className = 'ops-mission-row' + (m.enabled ? '' : ' disabled');
      const cron = escHtml(m.cron || '—');
      const nextRun = m.nextRun ? formatRelative(m.nextRun) : '—';
      const lastRun = m.lastRun ? formatRelative(m.lastRun) : '—';
      const errBadge = m.lastError ? `<span class="ops-mission-err" title="${escHtml(m.lastError)}">err</span>` : '';
      const triggerDisabled = !m.enabled || m.status === 'running';
      row.innerHTML = `
        <div class="ops-mission-head">
          <span class="${ledClass(m.status)}"></span>
          <span class="ops-mission-name">${escHtml(m.name)}</span>
          ${errBadge}
          ${m.hasPhases ? '<span class="ops-mission-tag">PHASED</span>' : ''}
          ${m.isDirect ? '<span class="ops-mission-tag">DIRECT</span>' : ''}
          ${!m.enabled ? '<span class="ops-mission-tag dim">DISABLED</span>' : ''}
          <span class="spacer"></span>
          <button class="ops-btn ops-btn-trigger" data-name="${escAttr(m.name)}" ${triggerDisabled ? 'disabled' : ''}>▶ Trigger</button>
        </div>
        <div class="ops-mission-meta">
          <span class="ops-meta-k">SCHEDULE</span><span class="ops-meta-v">${cron} <span class="dim">${escHtml(m.timezone || 'UTC')}</span></span>
          <span class="ops-meta-k">STATUS</span><span class="ops-meta-v">${escHtml(m.status || 'idle')}</span>
          <span class="ops-meta-k">LAST RUN</span><span class="ops-meta-v">${lastRun}${m.lastDuration ? ' · ' + formatDuration(m.lastDuration) : ''}</span>
          <span class="ops-meta-k">NEXT RUN</span><span class="ops-meta-v">${nextRun}</span>
        </div>
      `;
      list.appendChild(row);
    }
    list.querySelectorAll('.ops-btn-trigger').forEach(btn => {
      btn.addEventListener('click', () => triggerMission(btn.dataset.name));
    });
  }

  async function triggerMission(name) {
    try {
      await fetch(`/api/missions/${encodeURIComponent(name)}/trigger`, { method: 'POST' });
      // Optimistic — state will be updated by SSE
      const m = opsState.missions.find(x => x.name === name);
      if (m) { m.status = 'running'; renderMissions(); }
    } catch { /* ignore */ }
  }

  // ── Monitors tile ────────────────────────────────────────────────
  function renderMonitors() {
    const list = document.getElementById('ops-monitors-list');
    document.getElementById('ops-monitors-count').textContent = opsState.monitors.length;
    if (opsState.monitors.length === 0) {
      list.innerHTML = '<div class="ops-empty">No monitors configured.</div>';
      return;
    }
    list.innerHTML = '';
    for (const m of opsState.monitors) {
      const row = document.createElement('div');
      row.className = 'ops-monitor-row' + (m.enabled ? '' : ' disabled');
      const target = m.url || m.metric || '—';
      const valueStr = m.lastValue
        ? Object.entries(m.lastValue).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(' · ')
        : '—';
      row.innerHTML = `
        <div class="ops-mission-head">
          <span class="${ledClass(m.status)}"></span>
          <span class="ops-mission-name">${escHtml(m.name)}</span>
          <span class="ops-mission-tag">${escHtml((m.type || '').toUpperCase())}</span>
          ${!m.enabled ? '<span class="ops-mission-tag dim">DISABLED</span>' : ''}
        </div>
        <div class="ops-mission-meta">
          <span class="ops-meta-k">TARGET</span><span class="ops-meta-v">${escHtml(String(target))}</span>
          <span class="ops-meta-k">INTERVAL</span><span class="ops-meta-v">${escHtml(m.interval || '—')} <span class="dim">cooldown ${escHtml(m.cooldown || '—')}</span></span>
          <span class="ops-meta-k">LAST CHECK</span><span class="ops-meta-v">${formatRelative(m.lastCheck)}</span>
          <span class="ops-meta-k">VALUE</span><span class="ops-meta-v">${escHtml(valueStr)}${m.threshold != null ? ' <span class="dim">/ ' + m.threshold + '</span>' : ''}</span>
          ${m.lastTrigger ? `<span class="ops-meta-k">LAST TRIGGER</span><span class="ops-meta-v">${formatRelative(m.lastTrigger)}</span>` : ''}
        </div>
      `;
      list.appendChild(row);
    }
  }

  // ── Plugins tile ─────────────────────────────────────────────────
  function renderPlugins() {
    const list = document.getElementById('ops-plugins-list');
    document.getElementById('ops-plugins-count').textContent = opsState.plugins.length;
    if (opsState.plugins.length === 0) {
      list.innerHTML = '<div class="ops-empty">No plugins installed. <span class="dim">(npm install @goose-plugins/...)</span></div>';
      return;
    }
    list.innerHTML = '';
    for (const p of opsState.plugins) {
      const group = document.createElement('details');
      group.className = 'ops-plugin-group';
      const tools = (p.tools || []).map(t => `
        <li class="ops-plugin-tool">
          <span class="ops-tool-name">${escHtml(t.name)}</span>
          <span class="ops-tool-risk ops-tool-risk-${escAttr(t.riskLevel || 'safe')}">${escHtml(t.riskLevel || 'safe')}</span>
          <span class="ops-tool-desc">${escHtml(t.description || '')}</span>
        </li>
      `).join('');
      group.innerHTML = `
        <summary>
          <span class="ops-plugin-name">${escHtml(p.packageName)}</span>
          <span class="ops-plugin-version">${escHtml(p.version || '—')}</span>
          <span class="ops-plugin-source ops-plugin-source-${escAttr(p.source)}">${escHtml(p.source)}</span>
          <span class="dim">${p.tools?.length || 0} tool${p.tools?.length === 1 ? '' : 's'}</span>
        </summary>
        ${p.description ? `<div class="ops-plugin-desc">${escHtml(p.description)}</div>` : ''}
        ${p.loadError ? `<div class="ops-plugin-err">Load error: ${escHtml(p.loadError)}</div>` : ''}
        <ul class="ops-plugin-tools">${tools}</ul>
      `;
      list.appendChild(group);
    }
  }

  // ── System — populates header stats ─────────────────────────────
  function renderSystem() {
    const s = opsState.system;
    if (!s) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('ops-sys-tts',    s.ttsBackend || '—');
    set('ops-sys-uptime', formatUptime(s.uptime));
  }

  // ── Loaders ──────────────────────────────────────────────────────
  async function fetchJson(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Ops fetch failed', url, err);
      return null;
    }
  }

  async function loadOps() {
    const [audio, missions, monitors, plugins, system] = await Promise.all([
      fetchJson('/api/audio'),
      fetchJson('/api/missions'),
      fetchJson('/api/monitors'),
      fetchJson('/api/plugins'),
      fetchJson('/api/system'),
    ]);
    if (audio)    { opsState.audio    = audio.audio    || []; renderAudio(); }
    if (missions) { opsState.missions = missions.missions || []; renderMissions(); }
    if (monitors) { opsState.monitors = monitors.monitors || []; renderMonitors(); }
    if (plugins)  { opsState.plugins  = plugins.plugins || []; renderPlugins(); }
    if (system)   { opsState.system   = system; renderSystem(); }

    // Tick uptime once a second while the tab is open
    if (opsUptimeTimer) clearInterval(opsUptimeTimer);
    opsUptimeTimer = setInterval(() => {
      if (opsState.system) {
        opsState.system.uptime += 1;
        document.getElementById('ops-sys-uptime').textContent = formatUptime(opsState.system.uptime);
      }
    }, 1000);
  }

  // ── SSE handlers (broadcast) ─────────────────────────────────────
  es.addEventListener('audioCreated', e => {
    const entry = JSON.parse(e.data);
    if (!opsState.audio.find(a => a.id === entry.id)) {
      opsState.audio.unshift({ ...entry, missing: false, playable: true });
      document.getElementById('ops-audio-count').textContent = opsState.audio.length;
      renderAudio();
    }
  });

  es.addEventListener('audioDeleted', e => {
    const { id } = JSON.parse(e.data);
    opsState.audio = opsState.audio.filter(a => a.id !== id);
    document.getElementById('ops-audio-count').textContent = opsState.audio.length;
    renderAudio();
  });

  es.addEventListener('missionStateChanged', e => {
    const update = JSON.parse(e.data);
    const m = opsState.missions.find(x => x.name === update.name);
    if (m) {
      m.status = update.status;
      m.lastRun = update.lastRun ?? m.lastRun;
      m.lastError = update.lastError ?? null;
      m.lastDuration = update.lastDuration ?? m.lastDuration;
      renderMissions();
    }
  });

  es.addEventListener('monitorStateChanged', e => {
    const update = JSON.parse(e.data);
    const m = opsState.monitors.find(x => x.name === update.name);
    if (m) {
      Object.assign(m, update);
      renderMonitors();
    }
  });

  // escAttr: HTML attribute-safe encoding (used by Ops renderers).
  function escAttr(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── Init ─────────────────────────────────────────────────────────
  populateContexts();
  loadKanban();
  loadOps();
  setStatus('idle');
  taskInput.focus();
