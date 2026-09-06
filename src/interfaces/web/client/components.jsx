import { createContext, useContext, useEffect, useRef } from "react";
import { ArrowUpRight, Inbox, X } from "lucide-react";
import { display } from "./data.js";

export const ActionErrorContext = createContext(null);

export function Badge({ children, status = "" }) {
  const tone = /^(ok|completed|done|safe|verified|connected)$/.test(status)
    ? "green"
    : /fail|blocked|danger|urgent|error/.test(status)
      ? "red"
      : /running|progress|ready|moderate|trigger|cooldown/.test(status)
        ? "amber"
        : "";
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {children ||
        status.replaceAll("_", " ").replaceAll("-", " ") ||
        "Unknown"}
    </span>
  );
}
export function Empty({ title, children, icon: Icon = Inbox }) {
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Panel({ title, label, action, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          {label && <span className="eyebrow">{label}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function ViewLink({ view, children = "View all" }) {
  return (
    <a className="text-link" href={`#/${view}`}>
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
export function Resource({
  name,
  dashboard,
  children,
  empty,
  hasItems = true,
}) {
  if (dashboard.errors[name])
    return (
      <div className="resource-error" role="alert">
        <strong>Couldn’t load {name}.</strong>
        <p>{dashboard.errors[name]}</p>
        <button onClick={() => dashboard.refresh([name])}>Try again</button>
        {dashboard.data[name] && (
          <p>Previously loaded data may be out of date.</p>
        )}
      </div>
    );
  if (!dashboard.data[name])
    return (
      <div className="loading" role="status">
        Receiving telemetry…
      </div>
    );
  if (!hasItems) return empty;
  return children;
}
export function Modal({ title, children, onClose }) {
  const error = useContext(ActionErrorContext);
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-content">
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}
export function Approval({ item, onResolve, pending }) {
  return (
    <div className="approval">
      <div className="row">
        <strong>Approval required</strong>
        <Badge status="dangerous" />
      </div>
      <p>
        <code>{item.toolName}</code> is waiting for your decision.
      </p>
      <pre>{display(item.args)}</pre>
      <div className="actions">
        <button
          className="primary"
          disabled={pending}
          onClick={() => onResolve(item, true)}
        >
          Approve tool
        </button>
        <button disabled={pending} onClick={() => onResolve(item, false)}>
          Deny
        </button>
      </div>
    </div>
  );
}
export { Aircraft } from "./aircraft.jsx";
