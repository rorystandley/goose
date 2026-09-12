import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Check,
  Clock3,
  MessageSquare,
  Play,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  api,
  columns,
  date,
  display,
  duration,
  updateTimeline,
} from "./data.js";
import {
  Aircraft,
  Approval,
  Badge,
  Empty,
  Modal,
  Panel,
  Resource,
  ViewLink,
} from "./components.jsx";
import { PluginTiles } from "./pluginTiles.jsx";

export function Overview({ dashboard: d }) {
  const tasks = d.data.kanban || [],
    missions = d.data.missions || [],
    monitors = d.data.monitors || [];
  const active = tasks.filter((t) => t.status === "in-progress");
  const attention =
    tasks.filter((t) => t.status === "blocked").length +
    missions.filter((m) =>
      ["failed", "blocked", "budget_exhausted"].includes(m.status),
    ).length +
    monitors.filter((m) => m.status === "failed").length;
  const scheduled = missions
    .filter((m) => m.enabled && m.nextRun)
    .sort((a, b) => a.nextRun.localeCompare(b.nextRun));
  const stats = [
    [
      "Active tasks",
      active.length,
      "kanban",
      "board",
      "Currently in progress",
      Radio,
    ],
    [
      "Scheduled missions",
      missions.filter((m) => m.enabled).length,
      "missions",
      "missions",
      "Enabled in your flight plan",
      Clock3,
    ],
    [
      "Monitors",
      monitors.length,
      "monitors",
      "monitors",
      `${monitors.filter((m) => m.status === "ok").length} reporting healthy`,
      ShieldCheck,
    ],
    [
      "Completed tasks",
      tasks.filter((t) => t.status === "done").length,
      "kanban",
      "board",
      "Across your task board",
      Check,
    ],
  ];
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow accent">GOOSE / MISSION OPERATIONS</span>
          <h2>
            Your six.
            <br />
            Covered.
          </h2>
          <p>
            A clear picture of every mission, every signal,
            <br className="desktop-break" /> and everything your wingman is
            working on.
          </p>
          <a href="#/chat" className="button primary">
            Talk to me, Goose <ArrowUpRight size={17} />
          </a>
          <div className="hero-foot">
            <span className={`status-dot ${d.connected ? "online" : ""}`} />
            {d.connected
              ? "Live telemetry connected"
              : "Establishing telemetry link"}
          </div>
        </div>
        <div className="hero-graphic">
          <div className="instrument-label">
            AIRFRAME / F-14 TOMCAT<span>01—14</span>
          </div>
          <Aircraft />
          <div className="instrument-label">
            <span>REAR SEAT. FULL PICTURE.</span>
            <span>RIO / GOOSE</span>
          </div>
        </div>
      </section>
      <div className="stats">
        {stats.map(([label, value, resource, view, hint, Icon]) => (
          <a href={`#/${view}`} className="stat" key={label}>
            <div className="row">
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>
              {d.errors[resource]
                ? "—"
                : d.data[resource]
                  ? String(value).padStart(2, "0")
                  : "…"}
            </strong>
            <small>{d.errors[resource] ? "Telemetry unavailable" : hint}</small>
          </a>
        ))}
      </div>
      <div className="overview-grid">
        <Panel
          title="Flight plan"
          label="UP NEXT"
          action={<ViewLink view="missions" />}
        >
          <Resource
            name="missions"
            dashboard={d}
            hasItems={scheduled.length > 0}
            empty={
              <Empty title="A clear flight plan">
                Scheduled missions will appear here once configured.
              </Empty>
            }
          >
            {scheduled.slice(0, 4).map((m) => (
              <a href="#/missions" className="list-row" key={m.name}>
                <span className="row-icon">
                  <Clock3 size={18} />
                </span>
                <div className="grow">
                  <strong>{m.name}</strong>
                  <small>
                    {date(m.nextRun, m.timezone)} · {m.timezone}
                  </small>
                </div>
                <Badge status={m.status} />
                <ArrowUpRight size={15} />
              </a>
            ))}
          </Resource>
        </Panel>
        <Panel
          title="On your radar"
          label="SITUATION REPORT"
          action={<ViewLink view="monitors" />}
        >
          <div className="readiness">
            <span className={`readiness-icon ${attention ? "attention" : ""}`}>
              <Radio size={28} />
            </span>
            <h3>
              {Object.values(d.errors).some(Boolean)
                ? "Telemetry needs attention"
                : !d.data.kanban || !d.data.missions || !d.data.monitors
                  ? "Checking operations…"
                  : attention
                    ? `${attention} items need attention`
                    : "No issues reported"}
            </h3>
            <p>
              {attention
                ? "Review blocked tasks, mission failures, and monitor alerts."
                : "Stay ahead of the next signal. Monitor states and mission outcomes appear here."}
            </p>
            <div className="readiness-links">
              <ViewLink view="board">Task board</ViewLink>
              <ViewLink view="monitors">Monitor states</ViewLink>
            </div>
          </div>
        </Panel>
        <Panel
          title="Active operations"
          label="IN FLIGHT"
          action={<ViewLink view="board" />}
        >
          <Resource
            name="kanban"
            dashboard={d}
            hasItems={active.length > 0}
            empty={
              <Empty title="Standing by for your next task">
                Add a task to the board and move it to Ready when it’s cleared
                to run.
              </Empty>
            }
          >
            {active.map((t) => (
              <a className="list-row" href="#/board" key={t.id}>
                <Radio size={18} />
                <strong className="grow">{t.title}</strong>
                <Badge status={t.status} />
              </a>
            ))}
          </Resource>
        </Panel>
        <Panel title="Quick comms" label="YOUR WINGMAN">
          <div className="quick-comms">
            <MessageSquare size={24} />
            <h3>Let’s get to work.</h3>
            <p>
              Plan a task, investigate a signal, or ask Goose for a fresh
              perspective.
            </p>
            <a className="button" href="#/chat">
              Open comms <ArrowUpRight size={16} />
            </a>
          </div>
        </Panel>
      </div>
      <PluginTiles dashboard={d} />
    </>
  );
}

export function Chat({ dashboard: d, contextId, act, pending }) {
  const [draft, setDraft] = useState("");
  const bottom = useRef(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [d.timeline, d.busy]);
  async function send(event) {
    event.preventDefault();
    const task = draft.trim();
    if (!task || d.busy || !d.connected) return;
    d.setBusy(true);
    d.setTimeline((items) => updateTimeline(items, "user", { content: task }));
    setDraft("");
    try {
      await api("chat", "POST", { task, contextId });
    } catch (error) {
      d.setBusy(false);
      setDraft(task);
      d.setTimeline((items) =>
        updateTimeline(items, "agentError", { message: error.message }),
      );
    }
  }
  async function approve(item, approved) {
    await act(`approval-${item.approvalId}`, async () => {
      await api(approved ? "approve" : "deny", "POST", {
        approvalId: item.approvalId,
        contextId,
      });
      d.setTimeline((items) =>
        updateTimeline(items, "approvalResolved", {
          approvalId: item.approvalId,
          approved,
        }),
      );
    });
  }
  return (
    <section className="chat panel">
      <div className="chat-top">
        <span>
          <span className={`status-dot ${d.connected ? "online" : ""}`} />
          {d.connected
            ? "Comms link established"
            : "Reconnecting — sending paused"}
        </span>
        <code>{contextId}</code>
      </div>
      <div className="timeline" aria-live="polite" role="log">
        {!d.timeline.length && (
          <div className="chat-welcome">
            <div className="wingman">
              <Radio size={34} />
            </div>
            <span className="eyebrow">GOOSE IS ON YOUR WING</span>
            <h2>Talk to me, Goose.</h2>
            <p>Big plans or small questions. You have my attention.</p>
            <div className="suggestions">
              {[
                "Help me plan my next task",
                "What can you help me with?",
                "Give me a system briefing",
              ].map((text) => (
                <button key={text} onClick={() => setDraft(text)}>
                  {text}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          </div>
        )}
        {d.timeline.map((item) => (
          <article className={`message ${item.type}`} key={item.id}>
            {item.type === "toolCall" ? (
              item.requiresApproval && !item.resolved ? (
                <Approval
                  item={item}
                  onResolve={approve}
                  pending={pending === `approval-${item.approvalId}`}
                />
              ) : (
                <details className="tool-event">
                  <summary>
                    <code>{item.toolName}</code>
                    <Badge status={item.riskLevel} />
                    {item.resolved && (
                      <span>{item.approved ? "Approved" : "Denied"}</span>
                    )}
                  </summary>
                  <pre>{display(item.args)}</pre>
                  {item.result !== undefined && (
                    <pre>{display(item.result)}</pre>
                  )}
                </details>
              )
            ) : (
              <>
                <div className="message-label">
                  {item.type === "user"
                    ? "YOU"
                    : item.type === "agentError"
                      ? "COMMS ERROR"
                      : "GOOSE"}
                  <span>{date(item.time)}</span>
                </div>
                <div className="message-body">
                  {display(item.content ?? item.message)}
                </div>
              </>
            )}
          </article>
        ))}
        {d.busy && (
          <div className="thinking" role="status">
            <span className="status-dot online" />
            Goose is working…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form className="composer" onSubmit={send}>
        <label className="sr-only" htmlFor="chat-input">
          Message Goose
        </label>
        <textarea
          id="chat-input"
          rows="2"
          placeholder="Send a message to Goose…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send(e);
            }
          }}
        />
        <div className="composer-bottom">
          <small>Enter to send · Shift + Enter for a new line</small>
          <button
            className="primary"
            disabled={!draft.trim() || d.busy || !d.connected}
          >
            Send <ArrowUp size={16} />
          </button>
        </div>
      </form>
      <div className="chat-note">
        Live messages for this browser session. Stored conversations are
        available in Memory.
      </div>
    </section>
  );
}

function TaskForm({ task, onSave, onClose, pending }) {
  const [draft, setDraft] = useState({
    title: task?.title || "",
    description: task?.description || "",
    priority: task?.priority || "medium",
    tags: task?.tags?.join(", ") || "",
    files:
      task?.acceptance
        ?.filter((c) => c.type === "file")
        .map((c) => c.path)
        .join("\n") || "",
    allowDangerous: task?.allowDangerous || false,
  });
  const field = (key) => ({
    value: draft[key],
    onChange: (e) => setDraft({ ...draft, [key]: e.target.value }),
  });
  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            title: draft.title.trim(),
            description: draft.description,
            priority: draft.priority,
            tags: draft.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            allowDangerous: draft.allowDangerous,
            acceptance: [
              ...(task?.acceptance || []).filter((c) => c.type !== "file"),
              ...draft.files
                .split("\n")
                .map((p) => p.trim())
                .filter(Boolean)
                .map(
                  (path) =>
                    task?.acceptance?.find(
                      (c) => c.type === "file" && c.path === path,
                    ) || { type: "file", path },
                ),
            ],
          });
        }}
      >
        <label>
          Task title
          <input
            autoFocus
            required
            {...field("title")}
            placeholder="What needs to happen?"
          />
        </label>
        <label>
          Briefing
          <textarea
            rows="4"
            {...field("description")}
            placeholder="Give Goose the context and desired outcome."
          />
        </label>
        <div className="form-grid">
          <label>
            Priority
            <select {...field("priority")}>
              {["low", "medium", "high", "urgent"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Tags
            <input {...field("tags")} placeholder="research, weekly" />
          </label>
        </div>
        <label>
          Required output files
          <textarea
            rows="2"
            {...field("files")}
            placeholder="One file path per line"
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.allowDangerous}
            onChange={(e) =>
              setDraft({ ...draft, allowDangerous: e.target.checked })
            }
          />
          Auto-approve dangerous tools for this task
        </label>
        <p className="muted">
          New tasks enter Backlog. Moving a task to Ready allows Goose to
          execute it automatically.
        </p>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={pending || !draft.title.trim()}>
            {pending ? "Saving…" : "Save task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskLive({ contextId }) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const stream = new EventSource(
      `/api/events?contextId=${encodeURIComponent(contextId)}`,
    );
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    const listeners = [
      "toolCall",
      "toolResult",
      "agentResponse",
      "agentError",
    ].map((type) => {
      const listener = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setEvents((items) => updateTimeline(items, type, payload));
        } catch {
          /* Ignore malformed events. */
        }
      };
      stream.addEventListener(type, listener);
      return [type, listener];
    });
    return () => {
      listeners.forEach(([type, listener]) =>
        stream.removeEventListener(type, listener),
      );
      stream.close();
    };
  }, [contextId]);
  return (
    <section className="task-live">
      <h3>Live tool stream</h3>
      <p className="muted">
        {connected
          ? "Connected. Events appear here from the moment this task is opened."
          : "Connecting to task…"}
      </p>
      <div role="log" aria-live="polite">
        {events.map((event) => (
          <details key={event.id}>
            <summary>{event.toolName || event.type}</summary>
            <pre>{display(event.args || event.content || event.message)}</pre>
            {event.result !== undefined && <pre>{display(event.result)}</pre>}
          </details>
        ))}
      </div>
    </section>
  );
}

export function Board({ dashboard: d, act, pending, contextId }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const tasks = d.data.kanban || [];
  const selectedTask = tasks.find((t) => t.id === selected);
  async function mutate(id, method, body, suffix = "") {
    return act(`task-${id}`, async () => {
      await api(`kanban/${encodeURIComponent(id)}${suffix}`, method, body);
      await d.refresh(["kanban"]);
    });
  }
  async function resolve(item, approved) {
    await act(`approval-${item.approvalId}`, async () => {
      await api(approved ? "approve" : "deny", "POST", {
        approvalId: item.approvalId,
        contextId,
      });
      d.setApprovals((items) =>
        items.filter((a) => a.approvalId !== item.approvalId),
      );
    });
  }
  return (
    <>
      <div className="view-toolbar">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Filter tasks"
            placeholder="Filter tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="muted">Ready tasks run automatically</span>
        <button className="primary" onClick={() => setEditing({})}>
          <Plus size={16} />
          New task
        </button>
      </div>
      {d.approvals.map((item) => (
        <Approval
          key={item.approvalId}
          item={item}
          onResolve={resolve}
          pending={pending === `approval-${item.approvalId}`}
        />
      ))}
      <Resource name="kanban" dashboard={d}>
        <div className="board">
          {columns.map(([status, title]) => {
            const filtered = tasks.filter(
              (t) =>
                t.status === status &&
                `${t.title} ${t.description} ${t.tags?.join(" ")}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            );
            return (
              <section className={`board-column column-${status}`} key={status}>
                <div className="column-heading">
                  <span className="column-dot" />
                  <h2>{title}</h2>
                  <span>{filtered.length}</span>
                </div>
                <div className="cards">
                  {filtered.map((task) => (
                    <button
                      className="task-card"
                      key={task.id}
                      onClick={() => setSelected(task.id)}
                    >
                      <div className="row">
                        <span className="task-id">
                          {task.id.slice(-6).toUpperCase()}
                        </span>
                        <Badge status={task.priority} />
                      </div>
                      <h3>{task.title}</h3>
                      {task.description && <p>{task.description}</p>}
                      <div className="tags">
                        {task.tags?.map((tag, i) => (
                          <span key={i}>{tag}</span>
                        ))}
                      </div>
                      <div className="task-foot">
                        <span>{date(task.updatedAt)}</span>
                        {task.outcome?.verified && <ShieldCheck size={15} />}
                      </div>
                    </button>
                  ))}
                  {!filtered.length && (
                    <div className="column-empty">
                      {query ? "No matching tasks" : "No tasks here"}
                    </div>
                  )}
                </div>
                {status === "backlog" && (
                  <button className="add-task" onClick={() => setEditing({})}>
                    <Plus size={15} />
                    Add task
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </Resource>
      {editing && (
        <TaskForm
          task={editing.id ? editing : null}
          pending={pending === "save-task"}
          onClose={() => setEditing(null)}
          onSave={(draft) =>
            act("save-task", async () => {
              await api(
                editing.id
                  ? `kanban/${encodeURIComponent(editing.id)}`
                  : "kanban",
                editing.id ? "PUT" : "POST",
                draft,
              );
              setEditing(null);
              await d.refresh(["kanban"]);
            })
          }
        />
      )}
      {selectedTask && !editing && (
        <Modal title={selectedTask.title} onClose={() => setSelected(null)}>
          <div className="actions">
            <Badge status={selectedTask.status} />
            <Badge status={selectedTask.priority} />
            {selectedTask.outcome?.verified && <Badge status="verified" />}
          </div>
          <p className="preserve">
            {selectedTask.description || "No briefing provided."}
          </p>
          {selectedTask.acceptance?.length > 0 && (
            <details>
              <summary>Acceptance criteria</summary>
              <pre>{display(selectedTask.acceptance)}</pre>
            </details>
          )}
          {selectedTask.result && (
            <details open>
              <summary>Result</summary>
              <pre>{display(selectedTask.result)}</pre>
            </details>
          )}
          {selectedTask.outcome && (
            <details>
              <summary>Verification evidence</summary>
              <pre>{display(selectedTask.outcome)}</pre>
            </details>
          )}
          {selectedTask.status === "in-progress" && (
            <TaskLive
              key={selectedTask.id}
              contextId={selectedTask.contextId || `kanban-${selectedTask.id}`}
            />
          )}{" "}
          {selectedTask.contextId && (
            <a
              className="text-link"
              href={`#/memory?context=${encodeURIComponent(selectedTask.contextId)}`}
            >
              Inspect task memory <ArrowUpRight size={16} />
            </a>
          )}
          <div className="actions task-actions">
            {selectedTask.status !== "in-progress" && (
              <>
                <button
                  disabled={!!pending}
                  onClick={() => setEditing(selectedTask)}
                >
                  Edit
                </button>
                {selectedTask.status === "backlog" ? (
                  <button
                    className="primary"
                    disabled={!!pending}
                    onClick={() =>
                      mutate(selectedTask.id, "PUT", { status: "ready" })
                    }
                  >
                    Move to Ready
                  </button>
                ) : (
                  <button
                    disabled={!!pending}
                    onClick={() =>
                      mutate(selectedTask.id, "PUT", { status: "backlog" })
                    }
                  >
                    Return to Backlog
                  </button>
                )}
                {selectedTask.status === "ready" && (
                  <button
                    className="primary"
                    disabled={!!pending}
                    onClick={() =>
                      mutate(selectedTask.id, "POST", {}, "/trigger")
                    }
                  >
                    <Play size={14} />
                    Run now
                  </button>
                )}
                <button
                  className="danger"
                  disabled={!!pending}
                  onClick={() => {
                    if (confirm(`Delete “${selectedTask.title}”?`))
                      mutate(selectedTask.id, "DELETE");
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export function Missions({ dashboard: d, act, pending }) {
  const [filter, setFilter] = useState("all");
  const missions = (d.data.missions || []).filter(
    (m) => filter === "all" || (filter === "enabled" ? m.enabled : !m.enabled),
  );
  return (
    <>
      <div className="view-toolbar">
        <div className="segmented">
          {["all", "enabled", "disabled"].map((value) => (
            <button
              aria-pressed={filter === value}
              className={filter === value ? "active" : ""}
              key={value}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="muted">Schedules follow each mission’s timezone</span>
      </div>
      <Resource
        name="missions"
        dashboard={d}
        hasItems={missions.length > 0}
        empty={
          <Empty title="No missions in this view">
            Configure missions in your Goose missions file to build your flight
            plan.
          </Empty>
        }
      >
        <div className="detail-grid">
          {missions.map((m) => (
            <Panel
              key={m.name}
              title={m.name}
              action={<Badge status={m.enabled ? m.status : "disabled"} />}
            >
              <dl className="telemetry">
                <dt>Schedule</dt>
                <dd>
                  <code>{m.cron}</code> · {m.timezone}
                </dd>
                <dt>Next run</dt>
                <dd>
                  {m.enabled
                    ? date(m.nextRun, m.timezone)
                    : "Schedule disabled"}
                </dd>
                <dt>Last run</dt>
                <dd>{date(m.lastRun, m.timezone)}</dd>
                <dt>Duration</dt>
                <dd>
                  {m.lastDuration == null
                    ? "—"
                    : `${(m.lastDuration / 1000).toFixed(1)}s`}
                </dd>
                <dt>Verification</dt>
                <dd>{m.verified ? "Verified" : "Not verified"}</dd>
              </dl>
              {m.lastError && <p className="inline-error">{m.lastError}</p>}
              <div className="panel-footer">
                <a
                  className="text-link"
                  href={`#/memory?context=${encodeURIComponent(m.contextId)}`}
                >
                  Inspect memory <ArrowUpRight size={15} />
                </a>
                <button
                  disabled={m.status === "running" || pending === m.name}
                  onClick={() => {
                    const startNew = [
                      "failed",
                      "blocked",
                      "budget_exhausted",
                    ].includes(m.status);
                    if (
                      startNew &&
                      !confirm(
                        "Start this mission from the beginning? Previous actions may be repeated.",
                      )
                    )
                      return;
                    act(m.name, async () => {
                      await api(
                        `missions/${encodeURIComponent(m.name)}/trigger`,
                        "POST",
                        { startNew },
                      );
                      await d.refresh(["missions"]);
                    });
                  }}
                >
                  <Play size={14} />
                  {m.status === "running"
                    ? "Running"
                    : pending === m.name
                      ? "Starting…"
                      : "Run mission"}
                </button>
              </div>
            </Panel>
          ))}
        </div>
      </Resource>
    </>
  );
}

export function Monitors({ dashboard: d }) {
  return (
    <Resource
      name="monitors"
      dashboard={d}
      hasItems={d.data.monitors?.length > 0}
      empty={
        <Empty title="Your radar is clear" icon={Radio}>
          Configure monitors in Goose to track endpoints, metrics, and changes.
        </Empty>
      }
    >
      <div className="detail-grid">
        {d.data.monitors?.map((m) => (
          <Panel
            key={m.name}
            title={m.name}
            label={(m.type || "monitor").toUpperCase()}
            action={
              <Badge status={m.enabled === false ? "disabled" : m.status} />
            }
          >
            <dl className="telemetry">
              <dt>Target</dt>
              <dd>{m.url || m.metric || "—"}</dd>
              <dt>Interval</dt>
              <dd>{m.interval || "—"}</dd>
              <dt>Last check</dt>
              <dd>{date(m.lastCheck)}</dd>
              <dt>Last trigger</dt>
              <dd>{date(m.lastTrigger)}</dd>
              <dt>Cooldown</dt>
              <dd>{m.cooldown || "—"}</dd>
            </dl>
            {m.lastValue != null && (
              <pre className="monitor-value">{display(m.lastValue)}</pre>
            )}
            {m.lastError && <p className="inline-error">{m.lastError}</p>}
          </Panel>
        ))}
      </div>
    </Resource>
  );
}

export function Audio({ dashboard: d, act, pending }) {
  const [selected, setSelected] = useState(null);
  const audio = d.data.audio || [],
    current = audio.find((a) => a.id === selected);
  return (
    <>
      <Panel
        className="audio-player"
        title={
          current
            ? current.title ||
              current.filename ||
              current.missionName ||
              current.id
            : "Your next briefing awaits"
        }
        label="BRIEFING PLAYER"
        action={<AudioLines size={26} />}
      >
        <audio
          key={current?.id || "empty"}
          aria-label="Briefing audio player"
          src={
            current
              ? `/api/audio/${encodeURIComponent(current.id)}/stream`
              : undefined
          }
          controls
          autoPlay={!!current}
          preload="none"
        />
        <p className="muted">
          {current
            ? date(current.createdAt)
            : "Select an available recording from your library."}
        </p>
      </Panel>
      <Resource
        name="audio"
        dashboard={d}
        hasItems={audio.length > 0}
        empty={
          <Empty title="No briefings yet" icon={AudioLines}>
            Audio generated by Goose will appear in this library.
          </Empty>
        }
      >
        <div className="panel audio-library">
          {audio.map((a) => (
            <div className="audio-entry" key={a.id}>
              <div
                className={`list-row ${selected === a.id ? "selected" : ""}`}
              >
                <button
                  className="icon-button"
                  aria-label={`Play ${a.title || a.filename || a.missionName || a.id}`}
                  disabled={!a.playable}
                  onClick={() => setSelected(a.id)}
                >
                  <Play size={18} />
                </button>
                <div className="grow">
                  <strong>
                    {a.title || a.filename || a.missionName || a.id}
                  </strong>
                  <small>
                    {date(a.createdAt)} · {(a.format || "audio").toUpperCase()}
                    {a.missing
                      ? " · File missing"
                      : !a.playable
                        ? " · Outside configured audio directories"
                        : ""}
                  </small>
                </div>
                <button
                  className="icon-button danger"
                  aria-label={`Delete ${a.title || a.filename || a.missionName || a.id}`}
                  disabled={pending === a.id}
                  onClick={() => {
                    if (confirm(`Delete this recording and its audio file?`))
                      act(a.id, async () => {
                        await api(
                          `audio/${encodeURIComponent(a.id)}`,
                          "DELETE",
                        );
                        if (selected === a.id) setSelected(null);
                        await d.refresh(["audio"]);
                      });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {(a.text || a.missionName || a.duration) && (
                <details className="audio-transcript">
                  <summary>Transcript & recording details</summary>
                  <p>
                    {a.missionName ||
                      a.monitorName ||
                      a.contextId ||
                      "Ad-hoc recording"}
                    {a.duration ? ` · ${a.duration.toFixed(1)}s` : ""}
                  </p>
                  <pre>{a.text || "No transcript available."}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </Resource>
    </>
  );
}

export function Memory({ contextId, requestedContext, act, pending }) {
  const [contexts, setContexts] = useState([contextId]);
  const [selected, setSelected] = useState(requestedContext || contextId);
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (requestedContext) setSelected(requestedContext);
  }, [requestedContext]);
  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setError(null);
    Promise.all([
      api("contexts"),
      api(`memory?contextId=${encodeURIComponent(selected)}`),
    ])
      .then(([list, history]) => {
        if (!cancelled) {
          setContexts([...new Set([contextId, selected, ...list.contextIds])]);
          setMessages(history.messages);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, contextId, revision]);
  return (
    <>
      <div className="view-toolbar">
        <label className="context-picker">
          Context
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {[...new Set([selected, ...contexts])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setRevision((r) => r + 1)}>Refresh</button>
        <button
          className="danger"
          disabled={pending === "clear-memory" || !messages?.length}
          onClick={() => {
            if (
              confirm(
                `Clear conversation history for ${selected}? Long-term facts are kept.`,
              )
            )
              act("clear-memory", async () => {
                await api(
                  `memory?contextId=${encodeURIComponent(selected)}`,
                  "DELETE",
                );
                setRevision((r) => r + 1);
              });
          }}
        >
          <Trash2 size={15} />
          Clear history
        </button>
      </div>
      <p className="muted">
        Inspect any stored context. Your Comms session remains{" "}
        <code>{contextId}</code>.
      </p>
      {error ? (
        <div role="alert" className="resource-error">
          {error}
        </div>
      ) : messages === null ? (
        <div className="loading">Loading conversation…</div>
      ) : !messages.length ? (
        <Empty title="A fresh slate">
          No stored messages for this context yet.
        </Empty>
      ) : (
        <div className="memory-list">
          {messages.map((m, i) => (
            <article className="panel memory-message" key={i}>
              <div className="row">
                <Badge status={m.role}>{m.role}</Badge>
                <span className="eyebrow">
                  {String(i + 1).padStart(3, "0")}
                </span>
              </div>
              <pre>{display(m.content || m.tool_calls || m)}</pre>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function Plugins({ dashboard: d }) {
  return (
    <Resource
      name="plugins"
      dashboard={d}
      hasItems={d.data.plugins?.length > 0}
      empty={
        <Empty title="No plugins installed">
          Add Goose plugins to expand your wingman’s capabilities.
        </Empty>
      }
    >
      <div className="detail-grid">
        {d.data.plugins?.map((p) => (
          <Panel
            key={`${p.source}-${p.packageName}`}
            title={p.packageName}
            label={`${p.source || "plugin"} / ${p.version || "unversioned"}`}
            action={
              <Badge status={p.loadError ? "error" : "safe"}>
                {p.loadError ? "Load error" : `${p.tools?.length || 0} tools`}
              </Badge>
            }
          >
            {p.description && (
              <p className="panel-description">{p.description}</p>
            )}
            {p.loadError && <p className="inline-error">{p.loadError}</p>}
            <div className="plugin-tools">
              {p.tools?.map((t) => (
                <details key={t.name}>
                  <summary>
                    <code>{t.name}</code>
                    <Badge status={t.riskLevel || "safe"} />
                  </summary>
                  <p>{t.description || "No description provided."}</p>
                </details>
              ))}
            </div>
            {p.tiles?.length > 0 && (
              <div className="plugin-tiles-meta">
                <span className="eyebrow">TILES</span>
                <ul>
                  {p.tiles.map((tile) => (
                    <li key={tile.id}>
                      <code>{tile.id}</code>
                      <span>{tile.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </Resource>
  );
}

export function Systems({ dashboard: d, contextId }) {
  const s = d.data.system || {};
  return (
    <Resource name="system" dashboard={d}>
      <div className="detail-grid">
        <Panel title="Flight computer" label="RUNTIME">
          <dl className="telemetry">
            <dt>Agent</dt>
            <dd>{s.agentName}</dd>
            <dt>Backend</dt>
            <dd>{s.llmBackend}</dd>
            <dt>Uptime</dt>
            <dd>{duration(s.uptime)}</dd>
            <dt>Started</dt>
            <dd>{date(s.startedAt)}</dd>
            <dt>Event stream</dt>
            <dd>
              <Badge status={d.connected ? "connected" : "disconnected"} />
            </dd>
            <dt>Chat context</dt>
            <dd>
              <code>{contextId}</code>
            </dd>
          </dl>
        </Panel>
        <Panel title="Model routing" label="INTELLIGENCE">
          <dl className="telemetry">
            {[
              ["Primary", s.model],
              ["Fast", s.fastModel],
              ["Smart", s.smartModel],
              ["Routing", s.routingModel],
              ["Ollama host", s.ollamaHost],
            ].map(([k, v]) => (
              <div className="dl-pair" key={k}>
                <dt>{k}</dt>
                <dd>{v || "Not configured"}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Voice & audio" label="COMMS EQUIPMENT">
          <dl className="telemetry">
            <dt>Backend</dt>
            <dd>{s.ttsBackend}</dd>
            <dt>Model</dt>
            <dd>{s.ttsModel || "Default"}</dd>
            <dt>Voice</dt>
            <dd>{s.ttsVoice || "Default"}</dd>
            <dt>Audio directories</dt>
            <dd>
              {s.audioOutputDirsConfigured ? "Configured" : "Not configured"}
            </dd>
          </dl>
        </Panel>
        <Panel title="Local by design" label="STATION NOTES">
          <div className="panel-description">
            <p>Mission Control connects to the Goose server on your machine.</p>
            <p>
              Runtime settings are read-only here. Update your Goose environment
              configuration and restart the server to apply changes.
            </p>
            <p className="muted">
              Telemetry refreshes every 30 seconds and receives live updates
              over the event stream.
            </p>
          </div>
        </Panel>
      </div>
    </Resource>
  );
}
