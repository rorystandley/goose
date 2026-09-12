import { useEffect, useState } from "react";
import { date } from "./data.js";
import { Badge, Panel } from "./components.jsx";

/**
 * Renders command-centre tiles contributed by installed Goose plugins.
 * Tile metadata comes from GET /api/tiles (via the dashboard resource poll).
 * Each tile loads its own live payload from GET /api/tiles/data.
 */
export function PluginTiles({ dashboard: d }) {
  const tiles = d.data.tiles || [];
  if (d.errors.tiles) {
    return (
      <section className="plugin-tiles">
        <div className="section-heading">
          <span className="eyebrow">PLUGIN TILES</span>
          <h2>Command tiles</h2>
        </div>
        <p className="inline-error">
          Could not load plugin tiles: {d.errors.tiles}
        </p>
      </section>
    );
  }
  if (!tiles.length) return null;
  return (
    <section className="plugin-tiles">
      <div className="section-heading">
        <span className="eyebrow">PLUGIN TILES</span>
        <h2>Command tiles</h2>
        <p>Live surfaces contributed by installed plugins.</p>
      </div>
      <div className="plugin-tiles-grid">
        {tiles.map((tile) => (
          <PluginTile
            key={tile.key || `${tile.packageName}/${tile.id}`}
            tile={tile}
          />
        ))}
      </div>
    </section>
  );
}

function PluginTile({ tile }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function load() {
      try {
        const query = new URLSearchParams({
          plugin: tile.packageName,
          tile: tile.id,
        });
        const response = await fetch(`/api/tiles/data?${query}`);
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        if (!cancelled) {
          setPayload(body.data);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    load();
    const refreshMs = Math.max(15, tile.refreshSeconds || 60) * 1000;
    timer = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tile.packageName, tile.id, tile.refreshSeconds]);

  return (
    <Panel
      title={tile.title}
      label={tile.packageName}
      action={
        <Badge status={error ? "error" : loading ? "ready" : "safe"}>
          {error ? "Error" : loading ? "Loading" : "Live"}
        </Badge>
      }
    >
      {tile.description && (
        <p className="panel-description">{tile.description}</p>
      )}
      {loading && !payload && !error && (
        <p className="tile-muted">Loading…</p>
      )}
      {error && <p className="inline-error">{error}</p>}
      {payload && <TilePayload data={payload} />}
    </Panel>
  );
}

function TilePayload({ data }) {
  if (!data || typeof data !== "object") {
    return <p className="tile-muted">No data.</p>;
  }
  if (data.kind === "error") {
    return <p className="inline-error">{data.message || "Tile error."}</p>;
  }
  if (data.kind === "markdown" || data.kind === "text") {
    return (
      <div className="tile-text">
        <pre>{data.text || data.markdown || ""}</pre>
        {data.updatedAt && (
          <small className="tile-updated">{date(data.updatedAt)}</small>
        )}
      </div>
    );
  }
  if (data.kind === "stats" && Array.isArray(data.items)) {
    return (
      <div className="tile-stats">
        {data.items.map((item) => (
          <div
            className={`tile-stat tone-${item.tone || "neutral"}`}
            key={item.label}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
        {data.updatedAt && (
          <small className="tile-updated">{date(data.updatedAt)}</small>
        )}
      </div>
    );
  }

  const columns = Array.isArray(data.columns) ? data.columns : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!columns.length && !rows.length) {
    return (
      <div className="tile-empty">
        <p>{data.emptyMessage || "Nothing to show yet."}</p>
      </div>
    );
  }
  return (
    <div className="tile-table-wrap">
      <table className="tile-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.align === "right" ? "right" : undefined}
              >
                {col.label || col.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className={row.tone ? `tone-${row.tone}` : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={col.align === "right" ? "right" : undefined}
                >
                  {row.cells?.[col.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.footer && <p className="tile-footer">{data.footer}</p>}
      {data.updatedAt && (
        <small className="tile-updated">{date(data.updatedAt)}</small>
      )}
    </div>
  );
}
