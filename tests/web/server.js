// Isolated browser fixture. Never imports the agent, starts jobs, or reads user data.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { getHtml } from "../../src/interfaces/web/public.js";
const timestamp = new Date().toISOString();
let tasks = [];
const clients = new Set();
function emit(type, data) {
  for (const res of clients)
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
const missions = [
  {
    name: "Morning intelligence briefing",
    cron: "0 8 * * *",
    timezone: "Europe/London",
    enabled: true,
    status: "completed",
    verified: true,
    nextRun: timestamp,
    lastRun: timestamp,
    lastDuration: 12400,
    contextId: "mission-morning",
  },
  {
    name: "Weekly workspace review",
    cron: "0 17 * * FRI",
    timezone: "Europe/London",
    enabled: true,
    status: "idle",
    nextRun: timestamp,
    contextId: "mission-weekly",
  },
];
const resources = {
  missions: { missions },
  monitors: {
    monitors: [
      {
        name: "Local inference endpoint",
        type: "url",
        enabled: true,
        status: "ok",
        url: "http://localhost:11434",
        lastCheck: timestamp,
        interval: "5m",
        lastValue: { latency: "42ms" },
      },
    ],
  },
  system: {
    agentName: "Goose",
    model: "local-model",
    llmBackend: "ollama",
    uptime: 12480,
    startedAt: timestamp,
    ttsBackend: "say",
  },
  plugins: {
    plugins: [
      {
        packageName: "Workspace tools",
        source: "local",
        version: "1.0",
        tools: [
          {
            name: "read_file",
            description: "Read a workspace file.",
            riskLevel: "safe",
          },
        ],
      },
    ],
  },
  audio: {
    audio: [
      {
        id: "briefing-1",
        title: "Morning briefing",
        createdAt: timestamp,
        format: "wav",
        playable: true,
      },
    ],
  },
  contexts: { contextIds: ["mission-morning", "web-previous"] },
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const json = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (path === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write(":ok\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = body ? JSON.parse(body) : {};
  if (path === "/api/test/reset") {
    tasks = [];
    json({});
    return;
  }
  if (path === "/api/test/event") {
    emit(payload.type, payload.data);
    json({});
    return;
  }
  if (path === "/api/kanban") {
    if (req.method === "POST") {
      const task = {
        ...payload,
        id: `task-${tasks.length + 1}`,
        status: "backlog",
        updatedAt: timestamp,
      };
      tasks.push(task);
      emit("kanbanUpdate", { tasks });
      json({ task }, 201);
    } else json({ tasks });
    return;
  }
  if (path.startsWith("/api/kanban/")) {
    const id = path.split("/")[3],
      task = tasks.find((t) => t.id === id);
    if (req.method === "DELETE") tasks = tasks.filter((t) => t.id !== id);
    else Object.assign(task, payload);
    emit("kanbanUpdate", { tasks });
    json({ task });
    return;
  }
  if (path === "/api/chat") {
    json({}, 202);
    setTimeout(
      () =>
        emit("toolCall", {
          toolName: "write_file",
          args: { path: "/tmp/briefing.txt" },
          requiresApproval: true,
          riskLevel: "dangerous",
          approvalId: "test-approval",
        }),
      30,
    );
    return;
  }
  if (path === "/api/approve" || path === "/api/deny") {
    json({});
    emit("approvalResolved", {
      approvalId: payload.approvalId,
      approved: path.endsWith("approve"),
    });
    emit("agentResponse", { content: "Briefing complete." });
    return;
  }
  if (path === "/api/memory") {
    json({
      messages:
        req.method === "DELETE"
          ? []
          : [
              {
                role: "user",
                content: `History for ${url.searchParams.get("contextId")}`,
              },
            ],
    });
    return;
  }
  if (/\/api\/missions\/.+\/trigger/.test(path)) {
    json({}, 202);
    return;
  }
  if (path === "/api/audio/briefing-1/stream") {
    const wav = Buffer.alloc(44 + 8000);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(8000, 28);
    wav.writeUInt16LE(1, 32);
    wav.writeUInt16LE(8, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(8000, 40);
    wav.fill(128, 44);
    res.writeHead(200, { "Content-Type": "audio/wav" });
    res.end(wav);
    return;
  }
  if (path.startsWith("/api/")) {
    const value = resources[path.slice(5)];
    json(value || {}, value ? 200 : 404);
    return;
  }
  if (path === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getHtml("Goose", "local-model"));
    return;
  }
  const asset = {
    "/app.js": ["../../src/interfaces/web/dist/app.js", "text/javascript"],
    "/app.css": ["../../src/interfaces/web/dist/app.css", "text/css"],
    "/assets/goose.png": ["../../docs/assets/goose.png", "image/png"],
    "/favicon.ico": ["../../docs/assets/favicon.ico", "image/x-icon"],
  }[path];
  if (asset) {
    res.writeHead(200, { "Content-Type": asset[1] });
    res.end(await readFile(new URL(asset[0], import.meta.url)));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(4174, "127.0.0.1");
