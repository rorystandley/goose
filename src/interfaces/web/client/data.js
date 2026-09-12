import { useCallback, useEffect, useRef, useState } from "react";

export const sections = [
  ["overview", "Command centre", "Your operations, at a glance."],
  ["chat", "Comms", "A direct line to your wingman."],
  ["board", "Task board", "From the briefing room to mission complete."],
  ["missions", "Missions", "Scheduled operations and their latest outcomes."],
  ["monitors", "Radar", "Watch your systems. Surface what needs attention."],
  ["audio", "Briefings", "Your audio intelligence, ready for playback."],
  ["memory", "Memory", "Inspect the context behind the conversation."],
  ["plugins", "Loadout", "The tools and capabilities available to Goose."],
  ["system", "Systems", "Local runtime and model configuration."],
];
export const columns = [
  ["backlog", "Backlog"],
  ["ready", "Ready"],
  ["in-progress", "In progress"],
  ["blocked", "Needs attention"],
  ["done", "Complete"],
];
export const display = (value) =>
  value == null
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value, null, 2)
      : String(value);
export const date = (value, timeZone) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...(timeZone ? { timeZone } : {}),
      })
    : "—";
export const duration = (seconds) =>
  seconds == null
    ? "—"
    : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
export function getContext() {
  try {
    let id = localStorage.getItem("gooseContextId");
    if (!id) {
      id = `web-${crypto.randomUUID().slice(0, 8)}`;
      localStorage.setItem("gooseContextId", id);
    }
    return id;
  } catch {
    return `web-${crypto.randomUUID().slice(0, 8)}`;
  }
}
export async function api(path, method = "GET", body) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
export function updateTimeline(items, type, payload) {
  if (type === "toolResult") {
    const index = items.findLastIndex(
      (item) =>
        item.type === "toolCall" &&
        item.toolName === payload.toolName &&
        item.result === undefined,
    );
    return items.map((item, i) =>
      i === index ? { ...item, result: payload.result } : item,
    );
  }
  if (type === "approvalResolved")
    return items.map((item) =>
      item.approvalId === payload.approvalId
        ? { ...item, resolved: true, approved: payload.approved }
        : item,
    );
  return [
    ...items,
    {
      ...payload,
      type,
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
    },
  ].slice(-500);
}
const resources = {
  kanban: "tasks",
  missions: "missions",
  monitors: "monitors",
  audio: "audio",
  plugins: "plugins",
  tiles: "tiles",
  system: null,
};
export function useDashboard(contextId) {
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [connected, setConnected] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(null);
  const pending = useRef(new Set());
  const refresh = useCallback(async (names = Object.keys(resources)) => {
    await Promise.all(
      names.map(async (name) => {
        if (pending.current.has(name)) return;
        pending.current.add(name);
        try {
          const value = await api(name);
          setData((previous) => ({
            ...previous,
            [name]: resources[name] ? value[resources[name]] : value,
          }));
          setErrors((previous) => ({ ...previous, [name]: null }));
          setUpdated(new Date());
        } catch (error) {
          setErrors((previous) => ({ ...previous, [name]: error.message }));
        } finally {
          pending.current.delete(name);
        }
      }),
    );
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const es = new EventSource(
      `/api/events?contextId=${encodeURIComponent(contextId)}`,
    );
    es.onopen = () => {
      setConnected(true);
      refresh();
    };
    es.onerror = () => setConnected(false);
    const on = (name, action) =>
      es.addEventListener(name, (event) => {
        try {
          action(JSON.parse(event.data));
        } catch {
          /* Keep the event stream alive on malformed messages. */
        }
      });
    [
      "toolCall",
      "toolResult",
      "agentResponse",
      "agentError",
      "approvalResolved",
    ].forEach((type) =>
      on(type, (payload) => {
        setTimeline((items) => updateTimeline(items, type, payload));
        if (["agentResponse", "agentError"].includes(type)) setBusy(false);
        if (type === "approvalResolved")
          setApprovals((items) =>
            items.filter((item) => item.approvalId !== payload.approvalId),
          );
      }),
    );
    on("kanbanUpdate", (payload) => {
      setData((previous) => ({ ...previous, kanban: payload.tasks }));
      refresh(["kanban"]);
    });
    on("kanbanApproval", (payload) =>
      setApprovals((items) => [
        ...items.filter((item) => item.approvalId !== payload.approvalId),
        payload,
      ]),
    );
    on("missionStateChanged", () => refresh(["missions"]));
    on("monitorStateChanged", () => refresh(["monitors"]));
    on("audioCreated", () => refresh(["audio"]));
    on("audioDeleted", () => refresh(["audio"]));
    return () => {
      es.close();
      setConnected(false);
    };
  }, [contextId, refresh]);
  return {
    data,
    errors,
    refresh,
    connected,
    timeline,
    setTimeline,
    approvals,
    setApprovals,
    busy,
    setBusy,
    updated,
  };
}
