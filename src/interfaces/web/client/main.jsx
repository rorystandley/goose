import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  ChevronRight,
  Command,
  Cpu,
  Crosshair,
  Database,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  Package,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { duration, getContext, sections, useDashboard } from "./data.js";
import { ActionErrorContext, Modal } from "./components.jsx";
import {
  Audio,
  Board,
  Chat,
  Memory,
  Missions,
  Monitors,
  Overview,
  Plugins,
  Systems,
} from "./views.jsx";
import "./styles.css";

const icons = {
  overview: LayoutDashboard,
  chat: MessageSquare,
  board: ListTodo,
  missions: Crosshair,
  monitors: Activity,
  audio: AudioLines,
  memory: Database,
  plugins: Package,
  system: Cpu,
};
function route() {
  return window.location.hash.slice(2).split("?")[0] || "overview";
}
function App() {
  const [contextId] = useState(getContext);
  const dashboard = useDashboard(contextId);
  const [view, setView] = useState(route);
  const [hash, setHash] = useState(window.location.hash);
  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(null);
  const actionLock = useRef(false);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const onHash = () => {
      setView(route());
      setHash(window.location.hash);
      setNavOpen(false);
    };
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPalette((p) => !p);
        setSearch("");
      }
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
      clearInterval(timer);
    };
  }, []);
  const section = sections.find((s) => s[0] === view);
  async function act(key, operation) {
    if (actionLock.current) return;
    actionLock.current = true;
    setPending(key);
    setNotice(null);
    try {
      await operation();
      return true;
    } catch (error) {
      setNotice(error.message);
      return false;
    } finally {
      actionLock.current = false;
      setPending(null);
    }
  }
  const props = { dashboard, act, pending, contextId };
  const approvalCount =
    dashboard.approvals.length +
    dashboard.timeline.filter((t) => t.requiresApproval && !t.resolved).length;
  const name =
    dashboard.data.system?.agentName || window.__GOOSE?.agentName || "Goose";
  return (
    <ActionErrorContext.Provider value={notice}>
      <div className="app-shell">
        <a
          href="#main-content"
          className="skip-link"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main-content").focus();
          }}
        >
          Skip to content
        </a>
        {navOpen && (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        )}
        <aside className={`sidebar ${navOpen ? "open" : ""}`}>
          <a className="brand" href="#/overview">
            <span className="brand-mark">
              <img src="/assets/goose.png" alt="" />
            </span>
            <span>
              {name}
              <small>MISSION CONTROL</small>
            </span>
            <span className="brand-number">/14</span>
          </a>
          <button
            className="command-search"
            onClick={() => {
              setPalette(true);
              setSearch("");
            }}
          >
            <Search size={16} />
            <span>Go to…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="nav-label">OPERATIONS</div>
          <nav aria-label="Main navigation">
            {sections.map(([id, label], index) => {
              const Icon = icons[id];
              return (
                <div key={id}>
                  {index === 6 && (
                    <div className="nav-label secondary-label">
                      INTELLIGENCE
                    </div>
                  )}
                  <a
                    href={`#/${id}`}
                    className={view === id ? "nav-item active" : "nav-item"}
                    aria-current={view === id ? "page" : undefined}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    {id === "board" &&
                      dashboard.data.kanban?.filter(
                        (t) => t.status === "in-progress",
                      ).length > 0 && (
                        <span className="nav-count">
                          {
                            dashboard.data.kanban.filter(
                              (t) => t.status === "in-progress",
                            ).length
                          }
                        </span>
                      )}
                    {view === id && <span className="nav-active-dot" />}
                  </a>
                </div>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <div className="station">
              <span
                className={`status-dot ${dashboard.connected ? "online" : ""}`}
              />
              <span>
                {dashboard.connected
                  ? "Station connected"
                  : "Link reconnecting"}
                <small>LOCAL OPERATIONS</small>
              </span>
            </div>
            <div className="callsign">
              <span>CALLSIGN</span>
              <strong>GOOSE</strong>
              <span>RIO / 02</span>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(!navOpen)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              Mission Control
              <ChevronRight size={13} />
              <span>{section?.[1] || "Unknown view"}</span>
            </div>
            <div className="topbar-right">
              <span className="utc-clock">
                {now.toISOString().slice(11, 19)} <span>UTC</span>
              </span>
              <span className="local-badge">LOCAL</span>
              <span className="operator-avatar">G</span>
            </div>
          </header>
          <main id="main-content" tabIndex="-1">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {view === "overview"
                    ? "SITUATIONAL AWARENESS"
                    : "GOOSE / OPERATIONS"}
                </div>
                <h1>{section?.[1] || "View not found"}</h1>
                <p>{section?.[2] || "Choose a view from the navigation."}</p>
              </div>
              <button
                className="refresh-button"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  await dashboard.refresh();
                  setRefreshing(false);
                }}
              >
                <RefreshCw size={15} className={refreshing ? "spin" : ""} />
                <span>{refreshing ? "Refreshing" : "Refresh"}</span>
              </button>
            </div>
            {notice && (
              <div className="notice" role="alert">
                <span>{notice}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setNotice(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {!dashboard.connected && (
              <div className="connection-warning" role="status">
                Telemetry link reconnecting. Displayed data may be out of date;
                chat resumes when connected.
              </div>
            )}
            {approvalCount > 0 && (
              <div className="approval-banner">
                <span>
                  <strong>
                    {approvalCount} tool{" "}
                    {approvalCount === 1 ? "approval" : "approvals"} waiting
                  </strong>{" "}
                  · Goose needs your decision.
                </span>
                <a href={dashboard.approvals.length ? "#/board" : "#/chat"}>
                  Review approvals <ChevronRight size={15} />
                </a>
              </div>
            )}
            {view === "overview" && <Overview {...props} />}
            <div hidden={view !== "chat"}>
              <Chat {...props} />
            </div>
            {view === "board" && <Board {...props} />}
            {view === "missions" && <Missions {...props} />}
            {view === "monitors" && <Monitors {...props} />}
            {view === "audio" && <Audio {...props} />}
            {view === "memory" && (
              <Memory
                {...props}
                requestedContext={new URLSearchParams(hash.split("?")[1]).get(
                  "context",
                )}
              />
            )}
            {view === "plugins" && <Plugins {...props} />}
            {view === "system" && <Systems {...props} />}
            <footer className="page-footer">
              <span>
                <span
                  className={`status-dot ${dashboard.connected ? "online" : ""}`}
                />
                {dashboard.connected ? "LIVE DATA" : "LINK OFFLINE"}
                <span className="footer-divider">/</span>
                {dashboard.updated
                  ? `UPDATED ${dashboard.updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "AWAITING TELEMETRY"}
              </span>
              <span>
                UPTIME {duration(dashboard.data.system?.uptime)}
                <span className="footer-divider">/</span>GOOSE MISSION CONTROL
              </span>
            </footer>
          </main>
        </div>
        {palette && (
          <Modal title="Go to a view" onClose={() => setPalette(false)}>
            <div className="search palette-search">
              <Search size={18} />
              <input
                autoFocus
                aria-label="Search views"
                value={search}
                placeholder="Search Mission Control…"
                onChange={(e) => setSearch(e.target.value)}
              />
              <Command size={15} />
            </div>
            <div className="palette-results">
              {sections
                .filter((s) =>
                  `${s[1]} ${s[2]}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map(([id, label, description]) => (
                  <a
                    key={id}
                    href={`#/${id}`}
                    onClick={() => setPalette(false)}
                  >
                    <strong>{label}</strong>
                    <small>{description}</small>
                    <ArrowRight />
                  </a>
                ))}
            </div>
          </Modal>
        )}
      </div>
    </ActionErrorContext.Provider>
  );
}
function ArrowRight() {
  return <ChevronRight size={17} />;
}
createRoot(document.getElementById("app")).render(<App />);
