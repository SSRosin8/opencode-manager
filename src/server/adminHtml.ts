/** Inline admin console — design-matched shell + Proxy Pool (no build step). */

export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OCFreeRelay — Admin</title>
  <script>
    try {
      const storedTheme = localStorage.getItem("ocfr-theme");
      const savedTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
      const preferredTheme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      document.documentElement.dataset.theme = savedTheme || preferredTheme;
    } catch { document.documentElement.dataset.theme = "dark"; }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0a0e14;
      --bg-elevated: #0d1219;
      --sidebar: #080c11;
      --panel: #111821;
      --panel-2: #141c27;
      --border: #1c2736;
      --border-hi: #2a3a50;
      --text: #e8eef7;
      --text-2: #9aabc2;
      --muted: #6b7c93;
      --faint: #3d4d63;
      --blue: #3b82f6;
      --blue-hi: #60a5fa;
      --blue-dim: rgba(59, 130, 246, 0.14);
      --blue-border: rgba(59, 130, 246, 0.45);
      --ok: #22c55e;
      --ok-dim: rgba(34, 197, 94, 0.12);
      --ok-border: rgba(34, 197, 94, 0.35);
      --warn: #f59e0b;
      --warn-dim: rgba(245, 158, 11, 0.12);
      --warn-border: rgba(245, 158, 11, 0.4);
      --err: #ef4444;
      --err-dim: rgba(239, 68, 68, 0.12);
      --err-border: rgba(239, 68, 68, 0.4);
      --radius: 8px;
      --radius-sm: 6px;
      --topbar-h: 50px;
      --sidebar-w: 190px;
      --font: "IBM Plex Sans", system-ui, sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;
      --shadow: 0 8px 24px rgba(0,0,0,0.35);
      color-scheme: dark;
    }
    :root[data-theme="light"] {
      --bg: #f6f8fb;
      --bg-elevated: #ffffff;
      --sidebar: #ffffff;
      --panel: #ffffff;
      --panel-2: #eef2f7;
      --border: #d8e0eb;
      --border-hi: #aebdce;
      --text: #172033;
      --text-2: #40516a;
      --muted: #586b84;
      --faint: #a4b1c2;
      --blue: #2563eb;
      --blue-hi: #1d4ed8;
      --blue-dim: rgba(37, 99, 235, 0.09);
      --blue-border: rgba(37, 99, 235, 0.35);
      --ok: #15803d;
      --ok-dim: rgba(21, 128, 61, 0.08);
      --ok-border: rgba(21, 128, 61, 0.3);
      --warn: #a16207;
      --warn-dim: rgba(161, 98, 7, 0.08);
      --warn-border: rgba(161, 98, 7, 0.3);
      --err: #dc2626;
      --err-dim: rgba(220, 38, 38, 0.07);
      --err-border: rgba(220, 38, 38, 0.3);
      --shadow: 0 8px 24px rgba(40, 55, 75, 0.14);
      color-scheme: light;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--font);
      font-size: 13px;
      color: var(--text);
      background: var(--bg);
      line-height: 1.45;
      overflow: hidden;
    }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    a { color: var(--blue-hi); }

    /* ── Shell ── */
    .app { display: flex; flex-direction: column; height: 100vh; }
    .topbar {
      height: var(--topbar-h);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elevated);
      gap: 12px;
      z-index: 40;
    }
    .topbar-left, .topbar-right, .topbar-mid {
      display: flex; align-items: center; gap: 10px; min-width: 0;
    }
    .brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .brand-logo {
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--blue-dim); border: 1px solid var(--blue-border);
      display: grid; place-items: center;
    }
    .brand-logo svg { display: block; }
    .brand-name {
      font-weight: 600; font-size: 14px; letter-spacing: 0.01em;
    }
    .run-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 999px;
      background: var(--ok-dim); border: 1px solid var(--ok-border);
      color: var(--ok); font-size: 12px; font-weight: 600;
    }
    .run-pill.down {
      background: var(--err-dim); border-color: var(--err-border); color: var(--err);
    }
    .run-pill .dot {
      width: 6px; height: 6px; border-radius: 50%; background: currentColor;
      box-shadow: 0 0 6px currentColor;
    }
    .addr-box {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: var(--radius-sm);
      border: 1px solid var(--border); background: var(--panel);
      font-family: var(--mono); font-size: 12px; color: var(--text-2);
      max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .icon-btn {
      width: 30px; height: 30px; padding: 0;
      display: grid; place-items: center;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border); background: var(--panel);
      color: var(--text-2);
    }
    .icon-btn:hover { border-color: var(--border-hi); color: var(--text); background: var(--panel-2); }
    .lang-switch {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--muted); user-select: none;
    }
    .lang-switch button {
      background: none; border: none; color: var(--muted); padding: 2px 4px; font-weight: 500;
    }
    .lang-switch button.active { color: var(--text); }
    .lang-switch button:hover { color: var(--text); }
    .lang-switch .sep { color: var(--faint); }

    .body { display: flex; flex: 1; min-height: 0; }
    .sidebar {
      width: var(--sidebar-w); flex-shrink: 0;
      background: var(--sidebar);
      border-right: 1px solid var(--border);
      display: flex; flex-direction: column;
      padding: 12px 0 10px;
    }
    .nav { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; flex: 1; }
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      height: 36px; padding: 0 12px;
      border: none; border-radius: var(--radius-sm);
      background: transparent; color: var(--text-2);
      font-weight: 500; font-size: 13px; text-align: left; width: 100%;
      position: relative;
    }
    .nav-item svg { flex-shrink: 0; opacity: 0.85; }
    .nav-item:hover { background: rgba(255,255,255,0.03); color: var(--text); }
    :root[data-theme="light"] .nav-item:hover { background: rgba(15,23,42,0.04); }
    .nav-item.active {
      background: var(--blue-dim); color: var(--blue-hi);
    }
    .nav-item.active::before {
      content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px;
      border-radius: 0 2px 2px 0; background: var(--blue);
    }
    .nav-item.active svg { color: var(--blue); opacity: 1; }
    .sidebar-foot {
      padding: 12px 16px 4px; border-top: 1px solid var(--border);
      color: var(--muted); font-size: 11px; line-height: 1.5;
    }
    .sidebar-foot .ver { font-family: var(--mono); color: var(--text-2); }

    .content {
      flex: 1; min-width: 0; overflow: auto;
      padding: 18px 20px 28px;
      background: var(--bg);
    }
    .page { display: none; }
    .page.active { display: block; }

    /* ── Typography / chrome ── */
    .page-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
    }
    .page-head h1 {
      margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em;
    }
    .page-head .sub {
      margin: 4px 0 0; color: var(--muted); font-size: 13px;
    }
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      height: 32px; padding: 0 12px;
      border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--panel); color: var(--text); font-weight: 500; font-size: 13px;
      white-space: nowrap;
    }
    .btn:hover { border-color: var(--border-hi); background: var(--panel-2); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary {
      background: var(--blue); border-color: #2563eb; color: #fff;
    }
    .btn-primary:hover { background: #2563eb; border-color: #1d4ed8; filter: brightness(1.05); }
    .btn-danger {
      background: transparent; border-color: var(--err-border); color: var(--err);
    }
    .btn-danger:hover { background: var(--err-dim); }
    .btn-ghost { background: transparent; }
    .btn-sm { height: 28px; padding: 0 8px; font-size: 12px; }
    .btn-icon {
      width: 28px; height: 28px; padding: 0;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .panel-hd {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border);
      min-height: 42px;
    }
    .panel-hd h2, .panel-hd h3 {
      margin: 0; font-size: 13px; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
    }
    .panel-hd-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .collapse-toggle { width: 28px; padding: 0; font-size: 14px; }
    .collapsible-body.is-collapsed { display: none; }
    .metrics.is-collapsed { display: none; }
    .panel-bd { padding: 12px 14px; }
    .hint { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
    .mono { font-family: var(--mono); font-size: 12px; }
    .muted { color: var(--muted); }

    label.field {
      display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; font-weight: 500;
    }
    .input, .select, .textarea {
      width: 100%; height: 32px; padding: 0 10px;
      border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--bg); color: var(--text);
    }
    .textarea { height: auto; min-height: 72px; padding: 8px 10px; resize: vertical; }
    .input:focus, .select:focus, .textarea:focus {
      outline: none; border-color: var(--blue-border); box-shadow: 0 0 0 3px var(--blue-dim);
    }
    .input-wrap { position: relative; }
    .input-wrap .eye {
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
      background: none; border: none; color: var(--muted); padding: 4px; height: auto;
    }
    .input-wrap .eye:hover { color: var(--text); }
    .row { display: grid; gap: 10px; margin-bottom: 10px; }
    .row.two { grid-template-columns: 1fr 1fr; }
    .row.three { grid-template-columns: 1fr 1fr 1fr; }
    .check-row {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--bg); margin-bottom: 10px;
    }
    .check-row input { margin-top: 2px; accent-color: var(--blue); }
    .check-row label { color: var(--text); font-size: 13px; cursor: pointer; }

    .tag {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 1px 7px; border-radius: 999px;
      font-size: 11px; font-weight: 600; border: 1px solid var(--border); color: var(--muted);
      white-space: nowrap;
    }
    .tag.ok { background: var(--ok-dim); border-color: var(--ok-border); color: var(--ok); }
    .tag.warn { background: var(--warn-dim); border-color: var(--warn-border); color: var(--warn); }
    .tag.err { background: var(--err-dim); border-color: var(--err-border); color: var(--err); }
    .tag.blue { background: var(--blue-dim); border-color: var(--blue-border); color: var(--blue-hi); }
    .tag.info { background: rgba(255,255,255,0.04); }
    :root[data-theme="light"] .tag.info { background: rgba(15,23,42,0.04); }

    /* ── Metrics ── */
    .metrics {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 10px; margin-bottom: 14px;
    }
    .metric {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 12px 12px 10px; min-height: 92px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .metric .k {
      display: flex; align-items: center; gap: 6px;
      font-size: 11px; color: var(--muted); font-weight: 500; text-transform: none;
    }
    .metric .k svg { opacity: 0.7; }
    .metric .v { font-size: 16px; font-weight: 600; line-height: 1.2; }
    .metric .v.ok { color: var(--ok); }
    .metric .v.blue { color: var(--blue-hi); }
    .metric .foot {
      margin-top: auto; display: flex; align-items: center; justify-content: space-between;
      gap: 6px; font-size: 11px; color: var(--muted);
    }
    .spark {
      width: 64px; height: 22px; display: block; opacity: 0.9;
    }
    .donut-wrap { display: flex; align-items: center; gap: 10px; }
    .donut {
      width: 42px; height: 42px; border-radius: 50%;
      background: conic-gradient(var(--blue) var(--p, 0%), var(--border) 0);
      display: grid; place-items: center; flex-shrink: 0;
    }
    .donut::after {
      content: attr(data-pct);
      width: 30px; height: 30px; border-radius: 50%;
      background: var(--panel); display: grid; place-items: center;
      font-size: 10px; font-weight: 600; font-family: var(--mono); color: var(--text-2);
    }
    .legend-dots { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); }
    .legend-dots span::before {
      content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
      margin-right: 5px; vertical-align: middle;
    }
    .legend-dots .r::before { background: var(--ok); }
    .legend-dots .b::before { background: var(--blue); }

    /* ── Proxy Pool layout ── */
    .pp-grid {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: 12px;
      align-items: start;
    }
    .pp-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .pp-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

    /* Isolation map */
    .iso-body { display: grid; grid-template-columns: 1fr 150px; gap: 0; }
    .iso-map { padding: 10px 14px 12px; border-right: 1px solid var(--border); }
    .iso-cols {
      display: grid; grid-template-columns: 1fr 1.1fr 1fr; gap: 4px;
      font-size: 10px; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.04em; margin-bottom: 8px; font-weight: 600;
    }
    .iso-row {
      display: grid; grid-template-columns: 1fr auto 1.1fr auto 1fr;
      align-items: center; gap: 6px; margin-bottom: 8px;
    }
    .iso-node {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 8px 10px; min-width: 0;
    }
    .iso-node.shared { border-color: var(--warn-border); background: var(--warn-dim); }
    .iso-node .t { font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px; }
    .iso-node .s { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .iso-arrow { color: var(--faint); font-size: 12px; }
    .bridge-chip {
      font-size: 10px; font-weight: 600; color: var(--blue-hi);
      border: 1px dashed var(--blue-border); border-radius: 999px;
      padding: 2px 7px; white-space: nowrap; background: var(--blue-dim);
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .dot.ok { background: var(--ok); }
    .dot.warn { background: var(--warn); }
    .dot.err { background: var(--err); }
    .iso-legend {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; flex-wrap: wrap; margin-top: 6px; padding-top: 8px;
      border-top: 1px solid var(--border); font-size: 11px; color: var(--muted);
    }
    .iso-legend .items { display: flex; gap: 12px; }
    .iso-legend .items span { display: inline-flex; align-items: center; gap: 5px; }
    .iso-health {
      padding: 16px 14px; display: flex; flex-direction: column; align-items: center;
      text-align: center; gap: 8px; justify-content: center;
    }
    .iso-health .big {
      font-size: 28px; font-weight: 700; line-height: 1; font-family: var(--mono);
    }
    .iso-health .big span { font-size: 14px; color: var(--muted); font-weight: 500; }
    .iso-health .desc { font-size: 12px; color: var(--muted); max-width: 130px; }
    .shield {
      width: 48px; height: 48px; border-radius: 50%;
      background: var(--ok-dim); border: 1px solid var(--ok-border);
      display: grid; place-items: center; color: var(--ok);
    }
    .shield.warn { background: var(--warn-dim); border-color: var(--warn-border); color: var(--warn); }
    .shield.err { background: var(--err-dim); border-color: var(--err-border); color: var(--err); }
    .iso-health .status-txt { font-weight: 600; font-size: 12px; color: var(--ok); }
    .iso-health .status-txt.warn { color: var(--warn); }
    .iso-health .status-txt.err { color: var(--err); }

    /* Subscriptions */
    .sub-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;
    }
    .sub-card {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .sub-card.err { border-color: var(--err-border); }
    .sub-card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .sub-card .name { font-weight: 600; font-size: 13px; }
    .sub-card .url {
      font-family: var(--mono); font-size: 11px; color: var(--muted);
      display: flex; align-items: center; gap: 4px; min-width: 0;
    }
    .sub-card .url span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub-card .meta { font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; }
    .sub-card .proto { font-size: 11px; color: var(--text-2); }
    .sub-card .err-msg { font-size: 11px; color: var(--err); }
    .sub-card .acts { display: flex; gap: 6px; margin-top: auto; flex-wrap: wrap; }

    /* Table */
    .table-tools {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      padding: 10px 12px; border-bottom: 1px solid var(--border);
    }
    .table-tools .search {
      position: relative; flex: 1; min-width: 160px; max-width: 240px;
    }
    .table-tools .search input { padding-right: 28px; }
    .table-tools .search svg {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      color: var(--muted); pointer-events: none;
    }
    .table-tools .select { width: auto; min-width: 120px; }
    .table-wrap { overflow: auto; max-height: 360px; }
    .attempts-table { min-width: 980px; }
    .attempts-table td { vertical-align: top; }
    .attempt-error {
      max-width: 260px; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--muted); font-size: 11px; margin-top: 3px;
    }
    table.nodes {
      width: 100%; border-collapse: collapse; font-size: 12px;
    }
    table.nodes th {
      text-align: left; padding: 8px 10px; color: var(--muted);
      font-weight: 600; font-size: 11px; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: var(--panel); z-index: 1;
      white-space: nowrap;
    }
    table.nodes td {
      padding: 8px 10px; border-bottom: 1px solid var(--border);
      vertical-align: middle; white-space: nowrap;
    }
    table.nodes tr:hover td { background: rgba(255,255,255,0.02); }
    :root[data-theme="light"] table.nodes tr:hover td { background: rgba(15,23,42,0.025); }
    table.nodes tr.row-warn td { background: var(--warn-dim); }
    table.nodes tr.row-err td { background: rgba(239,68,68,0.06); }
    table.nodes .name-cell { display: flex; align-items: center; gap: 6px; font-weight: 500; }
    .table-foot {
      display: flex; justify-content: space-between; align-items: center;
      gap: 10px; flex-wrap: wrap; padding: 8px 12px; border-top: 1px solid var(--border);
      font-size: 11px; color: var(--muted);
    }
    .table-foot .sum b.ok { color: var(--ok); font-weight: 600; }
    .table-foot .sum b.warn { color: var(--warn); font-weight: 600; }
    .table-foot .sum b.err { color: var(--err); font-weight: 600; }
    .pager { display: flex; align-items: center; gap: 4px; }
    .pager button {
      min-width: 28px; height: 28px; padding: 0 6px;
      border: 1px solid var(--border); background: var(--bg);
      border-radius: var(--radius-sm); color: var(--text-2);
    }
    .pager button.active { background: var(--blue); border-color: var(--blue); color: #fff; }
    .pager button:disabled { opacity: 0.4; }
    .lat { font-family: var(--mono); font-size: 12px; }
    .lat.ok { color: var(--ok); }
    .lat.err { color: var(--err); }
    .lat.muted { color: var(--muted); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid var(--border-hi); border-top-color: var(--blue);
      border-radius: 50%; animation: spin 0.7s linear infinite;
      vertical-align: -2px; margin-right: 4px;
    }

    /* Side cards */
    .bridge-form .row { margin-bottom: 8px; }
    .bridge-actions { display: flex; gap: 8px; margin-top: 4px; }
    .bridge-actions .btn { flex: 1; }
    .probe-ok {
      margin-top: 10px; padding: 8px 10px; border-radius: var(--radius-sm);
      background: var(--ok-dim); border: 1px solid var(--ok-border);
      color: var(--ok); font-size: 12px; display: none; align-items: center; gap: 6px;
    }
    .probe-ok.show { display: flex; }
    .probe-ok.fail {
      background: var(--err-dim); border-color: var(--err-border); color: var(--err);
    }

    .activity-list { list-style: none; margin: 0; padding: 0; }
    .activity-list li {
      display: grid; grid-template-columns: 14px 1fr auto; gap: 8px;
      padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px;
    }
    .activity-list li:last-child { border-bottom: none; }
    .activity-list .title { font-weight: 500; }
    .activity-list .sub { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .activity-list .time { color: var(--muted); font-size: 11px; white-space: nowrap; }
    .empty-dash {
      border: 1px dashed var(--border-hi); border-radius: var(--radius);
      padding: 20px 12px; text-align: center; color: var(--muted);
    }
    .empty-dash .ico { font-size: 22px; margin-bottom: 6px; opacity: 0.6; }
    .empty-dash strong { display: block; color: var(--text-2); margin-bottom: 2px; }

    /* Other pages */
    .stack { display: flex; flex-direction: column; gap: 12px; max-width: 880px; }
    .worker-card {
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--bg); padding: 12px 14px; margin-bottom: 10px;
    }
    .worker-card.disabled-worker { opacity: 0.68; }
    .workers-stack { max-width: none; }
    #accounts.worker-columns {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
      align-items: start;
    }
    .worker-column {
      min-width: 0;
    }
    .worker-column-hd {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid var(--border);
      color: var(--text); font-weight: 600;
    }
    .worker-column-count {
      min-width: 24px; padding: 1px 7px; border-radius: 999px;
      background: var(--panel-2); color: var(--text-2); text-align: center;
      font-family: var(--mono); font-size: 11px;
    }
    .worker-column-list { padding-top: 10px; }
    .worker-column-list.worker-list-scroll {
      max-height: calc(100vh - 235px); overflow: auto; padding-right: 6px;
    }
    .worker-column-list .worker-card:last-child { margin-bottom: 0; }
    .worker-column-empty {
      margin: 0; padding: 20px 10px; text-align: center; color: var(--muted);
    }
    .worker-card.is-collapsed-card { padding: 9px 12px; margin-bottom: 6px; }
    .worker-card.is-collapsed-card .hd { margin-bottom: 0; }
    .worker-card .hd {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px; font-weight: 600;
    }
    .worker-card .worker-actions {
      display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; align-items: center;
    }
    .worker-card .worker-title {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .worker-card .worker-body.is-collapsed { display: none; }
    .worker-test-result {
      margin-top: 10px; padding: 8px 10px; border: 1px solid var(--border);
      border-radius: var(--radius); color: var(--text-2); font-size: 12px;
    }
    .worker-test-result.ok { border-color: rgba(34,197,94,.35); color: var(--ok); }
    .worker-test-result.fail { border-color: rgba(239,68,68,.35); color: var(--err); }
    .usage-box {
      border: 1px dashed var(--border-hi); border-radius: var(--radius);
      padding: 14px 16px; background: var(--panel); line-height: 1.7; color: var(--text-2);
    }
    .usage-box code {
      font-family: var(--mono); font-size: 12px; color: var(--blue-hi);
      background: var(--blue-dim); padding: 1px 5px; border-radius: 4px;
    }

    /* Toast / Modal */
    .toast {
      position: fixed; left: 20px; bottom: 20px; z-index: 100;
      display: none; align-items: center; gap: 10px;
      padding: 10px 12px; min-width: 240px; max-width: 380px;
      background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow); font-size: 13px;
    }
    .toast.show { display: flex; }
    .toast.ok { border-color: var(--ok-border); }
    .toast.fail { border-color: var(--err-border); }
    .toast .x { margin-left: auto; background: none; border: none; color: var(--muted); padding: 2px 4px; }
    .modal-root {
      position: fixed; inset: 0; z-index: 90; display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.45);
    }
    .modal-root.show { display: flex; }
    .modal {
      width: min(420px, calc(100vw - 32px));
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 10px; box-shadow: var(--shadow); padding: 16px;
    }
    .modal h3 {
      margin: 0 0 6px; font-size: 15px; display: flex; align-items: center; gap: 8px;
    }
    .modal p { margin: 0 0 14px; color: var(--muted); font-size: 13px; }
    .modal .acts { display: flex; justify-content: flex-end; gap: 8px; }
    .modal.form .row { margin-bottom: 10px; }
    .confirm-float {
      position: fixed; right: 24px; bottom: 24px; z-index: 95;
      width: 300px; display: none;
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 10px; box-shadow: var(--shadow); padding: 14px;
    }
    .confirm-float.show { display: block; }
    .confirm-float h3 {
      margin: 0 0 6px; font-size: 14px; display: flex; align-items: center; gap: 8px;
    }
    .confirm-float p { margin: 0 0 4px; color: var(--muted); font-size: 12px; }
    .confirm-float .acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .confirm-float .close {
      position: absolute; top: 10px; right: 10px;
      background: none; border: none; color: var(--muted); padding: 2px;
    }

    .toggle {
      position: relative; width: 36px; height: 20px; flex-shrink: 0;
    }
    .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle span {
      position: absolute; inset: 0; border-radius: 999px;
      background: var(--faint); border: 1px solid var(--border); cursor: pointer;
      transition: background 0.15s;
    }
    .toggle span::after {
      content: ""; position: absolute; width: 14px; height: 14px; border-radius: 50%;
      background: #fff; top: 2px; left: 2px; transition: transform 0.15s;
    }
    .toggle input:checked + span { background: var(--blue); border-color: var(--blue); }
    .toggle input:checked + span::after { transform: translateX(16px); }

    .more-menu {
      position: absolute; right: 0; top: calc(100% + 4px); z-index: 30;
      min-width: 160px; background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow); display: none; padding: 4px;
    }
    .more-menu.show { display: block; }
    .more-menu button {
      width: 100%; text-align: left; background: none; border: none;
      color: var(--text); padding: 8px 10px; border-radius: 4px; font-size: 12px;
    }
    .more-menu button:hover { background: var(--blue-dim); }
    .rel { position: relative; }

    @media (max-width: 1200px) {
      .metrics { grid-template-columns: repeat(3, 1fr); }
      .pp-grid { grid-template-columns: 1fr; }
      .iso-body { grid-template-columns: 1fr; }
      .iso-map { border-right: none; border-bottom: 1px solid var(--border); }
    }
    @media (max-width: 900px) {
      .topbar { padding: 0 10px; gap: 8px; }
      .addr-box { display: none; }
      .body { flex-direction: column; }
      .sidebar {
        display: flex; width: 100%; height: 48px; padding: 6px;
        border-right: none; border-bottom: 1px solid var(--border);
        overflow-x: auto; overflow-y: hidden;
      }
      .nav { flex: none; flex-direction: row; gap: 4px; padding: 0; }
      .nav-item { width: auto; flex-shrink: 0; padding: 0 10px; }
      .nav-item.active::before {
        left: 10px; right: 10px; top: auto; bottom: -6px;
        width: auto; height: 2px; border-radius: 2px 2px 0 0;
      }
      .sidebar-foot { display: none; }
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .row.two, .row.three { grid-template-columns: 1fr; }
      body { overflow: auto; }
      .app { height: auto; min-height: 100vh; }
      .content { overflow: visible; padding: 14px 12px 24px; }
      #accounts.worker-columns { grid-template-columns: 1fr; }
      .worker-column-list.worker-list-scroll { max-height: 62vh; }
      .worker-card .hd { flex-wrap: wrap; gap: 8px; }
      .worker-card .hd { position: relative; }
      .worker-card .worker-title { width: 100%; padding-right: 34px; }
      .worker-card .worker-actions { flex-wrap: wrap; }
      .worker-card .btn-toggle-worker { position: absolute; top: 0; right: 0; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="topbar-left">
        <div class="brand">
          <div class="brand-logo" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="3" cy="8" r="2" fill="#3b82f6"/>
              <circle cx="13" cy="3.5" r="2" fill="#3b82f6"/>
              <circle cx="13" cy="12.5" r="2" fill="#3b82f6"/>
              <path d="M5 8h4M11 4.5L9 7M11 11.5L9 9" stroke="#3b82f6" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="brand-name">OCFreeRelay</span>
        </div>
        <div class="topbar-mid">
          <div id="run-pill" class="run-pill down"><span class="dot"></span><span id="run-label">—</span></div>
          <div class="addr-box" id="addr-box" title="Gateway address">http://127.0.0.1:9876</div>
          <button type="button" class="icon-btn" id="btn-top-refresh" title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/></svg>
          </button>
        </div>
      </div>
      <div class="topbar-right">
        <button type="button" class="icon-btn" id="btn-theme" title="Use light theme" aria-label="Use light theme">
          <span id="theme-icon" aria-hidden="true">☀</span>
        </button>
        <div class="lang-switch" role="group" aria-label="Language">
          <button type="button" id="lang-en" data-lang="en" class="active">EN</button>
          <span class="sep">|</span>
          <button type="button" id="lang-zh" data-lang="zh">中文</button>
        </div>
      </div>
    </header>

    <div class="body">
      <aside class="sidebar">
        <nav class="nav" id="main-nav">
          <button type="button" class="nav-item" data-page="overview">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-10.5z"/></svg>
            <span data-i18n="navOverview">Overview</span>
          </button>
          <button type="button" class="nav-item" data-page="gateway">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 10h18M8 21h8"/></svg>
            <span data-i18n="navGateway">Gateway</span>
          </button>
          <button type="button" class="nav-item active" data-page="proxy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11 15.5 7.2M8.2 13l7.3 3.8"/></svg>
            <span data-i18n="navProxy">Proxy Pool</span>
          </button>
          <button type="button" class="nav-item" data-page="workers">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a3 3 0 0 1 0 5.74"/></svg>
            <span data-i18n="navWorkers">Workers</span>
          </button>
          <button type="button" class="nav-item" data-page="usage">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5M4 19h16M8 16l3-4 3 2 4-6"/></svg>
            <span data-i18n="navUsage">Client Usage</span>
          </button>
        </nav>
        <div class="sidebar-foot">
          <div class="ver">v1.0.0</div>
          <div data-i18n="selfHosted">Self-hosted</div>
        </div>
      </aside>

      <main class="content">
        <!-- Overview -->
        <div class="page" id="page-overview" data-page="overview">
          <div class="page-head">
            <div>
              <h1 data-i18n="navOverview">Overview</h1>
              <p class="sub" data-i18n="overviewSub">Gateway health, workers, and proxy pool at a glance.</p>
            </div>
            <div class="page-actions">
              <button type="button" class="btn btn-sm collapse-toggle" data-collapse-key="overview-metrics" data-collapse-target="ov-metrics" aria-expanded="true"><span aria-hidden="true">▴</span></button>
              <button type="button" class="btn" id="btn-reset-stats" data-i18n="resetStats">Reset stats</button>
            </div>
          </div>
          <div class="metrics" id="ov-metrics"></div>
          <div class="panel" style="margin-top:12px">
            <div class="panel-hd">
              <h2 data-i18n="workerUsage">Worker usage</h2>
              <div class="panel-hd-actions">
                <span class="muted mono" id="ov-usage-totals"></span>
                <button type="button" class="btn btn-sm collapse-toggle" data-collapse-key="overview-worker-usage" data-collapse-target="ov-worker-usage-body" aria-expanded="true"><span aria-hidden="true">▴</span></button>
              </div>
            </div>
            <div class="collapsible-body" id="ov-worker-usage-body">
              <div class="table-wrap">
                <table class="nodes">
                <thead>
                  <tr>
                    <th data-i18n="colIdentity">Zen identity</th>
                    <th data-i18n="colRouteEgress">Route / egress</th>
                    <th data-i18n="colRequests">Requests</th>
                    <th data-i18n="colSuccessErrors">Success / errors</th>
                    <th data-i18n="colTokens">Tokens</th>
                    <th data-i18n="colCache">Cache</th>
                    <th data-i18n="colState">State</th>
                    <th data-i18n="colLastReq">Last request</th>
                  </tr>
                </thead>
                <tbody id="ov-worker-stats"></tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="panel" style="margin-top:12px">
            <div class="panel-hd">
              <h2 data-i18n="recentAttempts">Recent upstream attempts</h2>
              <span class="muted" data-i18n="recentAttemptsSub">Retries share the same request ID.</span>
            </div>
            <div class="table-wrap">
              <table class="nodes attempts-table">
                <thead>
                  <tr>
                    <th data-i18n="colTime">Time</th>
                    <th data-i18n="colRequest">Request</th>
                    <th data-i18n="colOperation">Operation</th>
                    <th data-i18n="colIdentity">Zen identity</th>
                    <th data-i18n="colRouteEgress">Route / egress</th>
                    <th data-i18n="colResult">Result</th>
                    <th data-i18n="colLatency">Latency</th>
                    <th data-i18n="colSwitch">Switch</th>
                  </tr>
                </thead>
                <tbody id="ov-attempts"></tbody>
              </table>
            </div>
          </div>
          <div class="panel" style="margin-top:12px">
            <div class="panel-hd"><h2 data-i18n="recentErrors">Recent errors</h2></div>
            <div class="panel-bd"><ul class="activity-list" id="ov-errors"></ul></div>
          </div>
        </div>

        <!-- Gateway -->
        <div class="page" id="page-gateway" data-page="gateway">
          <div class="page-head">
            <div>
              <h1 data-i18n="navGateway">Gateway</h1>
              <p class="sub" data-i18n="gatewaySub">Upstream target, listen port, and CLI identity headers.</p>
            </div>
            <div class="page-actions">
              <button type="button" class="btn btn-primary" id="btn-save-gateway" data-i18n="saveChanges">Save Changes</button>
            </div>
          </div>
          <div class="stack">
            <div class="panel">
              <div class="panel-bd">
                <div class="row">
                  <div>
                    <label class="field" for="baseUrl" data-i18n="upstreamBaseUrl">Upstream base URL</label>
                    <input class="input" id="baseUrl" type="text" placeholder="https://opencode.ai/zen/v1" />
                  </div>
                </div>
                <div class="row">
                  <div>
                    <label class="field" for="relayAccessToken" data-i18n="relayAccessToken">Relay access token (X-OC-Relay-Key)</label>
                    <input class="input" id="relayAccessToken" type="password" autocomplete="new-password" />
                  </div>
                </div>
                <div class="row two">
                  <div>
                    <label class="field" for="port" data-i18n="listenPort">Listen port (restart to apply)</label>
                    <input class="input" id="port" type="number" min="1" max="65535" />
                  </div>
                  <div>
                    <label class="field" for="cliUserAgent" data-i18n="cliUserAgent">CLI User-Agent</label>
                    <input class="input" id="cliUserAgent" type="text" />
                  </div>
                </div>
                <div class="row two">
                  <div>
                    <label class="field" for="cliClient">x-opencode-client</label>
                    <input class="input" id="cliClient" type="text" />
                  </div>
                  <div>
                    <label class="field" for="cliProject">x-opencode-project</label>
                    <input class="input" id="cliProject" type="text" />
                  </div>
                </div>
                <div class="check-row">
                  <input id="synthesizeCliHeaders" type="checkbox" />
                  <label for="synthesizeCliHeaders" data-i18n="synthesizeCli">Synthesize OpenCode CLI identity headers (VPS / Cloudflare)</label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Proxy Pool (design page) -->
        <div class="page active" id="page-proxy" data-page="proxy">
          <div class="page-head">
            <div>
              <h1 data-i18n="proxyPoolTitle">Proxy Pool</h1>
              <p class="sub" data-i18n="proxyPoolSub">Isolate every OpenCode account with a dedicated egress IP.</p>
            </div>
            <div class="page-actions">
              <button type="button" class="btn btn-sm collapse-toggle" data-collapse-key="proxy-metrics" data-collapse-target="pp-metrics" aria-expanded="true"><span aria-hidden="true">▴</span></button>
              <button type="button" class="btn btn-primary" id="btn-add-proxy-open">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>
                <span data-i18n="addProxy">Add Proxy</span>
              </button>
              <button type="button" class="btn" id="btn-add-sub-open">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>
                <span data-i18n="addSubscription">Add Subscription</span>
              </button>
              <button type="button" class="btn" id="btn-fetch-all">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>
                <span data-i18n="pullAll">Pull All</span>
              </button>
              <div class="rel">
                <button type="button" class="btn" id="btn-more">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
                  <span data-i18n="more">More</span>
                </button>
                <div class="more-menu" id="more-menu">
                  <button type="button" id="menu-refresh" data-i18n="refreshAll">Refresh all</button>
                  <button type="button" id="menu-goto-workers" data-i18n="reviewBindings">Review Bindings</button>
                </div>
              </div>
            </div>
          </div>

          <div class="metrics" id="pp-metrics"></div>

          <div class="pp-grid">
            <div class="pp-main">
              <!-- Isolation -->
              <div class="panel">
                <div class="panel-hd">
                  <h2>
                    <span data-i18n="isoTitle">IP Isolation Overview</span>
                    <span class="muted" title="Worker → Proxy → Egress">ⓘ</span>
                  </h2>
                  <button type="button" class="btn btn-sm collapse-toggle" data-collapse-key="proxy-isolation" data-collapse-target="proxy-isolation-body" aria-expanded="true"><span aria-hidden="true">▴</span></button>
                </div>
                <div class="iso-body collapsible-body" id="proxy-isolation-body">
                  <div class="iso-map">
                    <div class="iso-cols">
                      <div data-i18n="colWorker">Worker / API Key</div>
                      <div data-i18n="colProxy">Proxy Node / Route</div>
                      <div data-i18n="colEgress">Egress IP</div>
                    </div>
                    <div id="iso-rows"></div>
                    <div class="iso-legend">
                      <div class="items">
                        <span><i class="dot ok"></i><span data-i18n="legUnique">Unique IP</span></span>
                        <span><i class="dot warn"></i><span data-i18n="legShared">Shared IP</span></span>
                        <span><i class="dot err"></i><span data-i18n="legIssue">Issue</span></span>
                      </div>
                      <div id="iso-updated" class="muted"></div>
                    </div>
                  </div>
                  <div class="iso-health" id="iso-health"></div>
                </div>
              </div>

              <!-- Subscriptions -->
              <div class="panel">
                <div class="panel-hd"><h2 data-i18n="subscriptions">Subscriptions</h2></div>
                <div class="panel-bd"><div class="sub-grid" id="sub-grid"></div></div>
              </div>

              <!-- Nodes table -->
              <div class="panel">
                <div class="panel-hd">
                  <h2 data-i18n="proxyNodes">Proxy Nodes</h2>
                  <button type="button" class="btn btn-sm collapse-toggle" data-collapse-key="proxy-nodes" data-collapse-target="proxy-nodes-body" aria-expanded="true"><span aria-hidden="true">▴</span></button>
                </div>
                <div class="collapsible-body" id="proxy-nodes-body">
                  <div class="table-tools">
                  <div class="search">
                    <input class="input" id="node-search" type="search" data-i18n-placeholder="searchNodes" placeholder="Search nodes..." />
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
                  </div>
                  <select class="select" id="flt-proto">
                    <option value="" data-i18n="allProtocols">All Protocols</option>
                  </select>
                  <select class="select" id="flt-source">
                    <option value="" data-i18n="allSources">All Sources</option>
                    <option value="manual" data-i18n="srcManual">Manual</option>
                    <option value="subscription" data-i18n="srcSub">Subscription</option>
                    <option value="controller" data-i18n="srcController">Controller</option>
                  </select>
                  <select class="select" id="flt-health">
                    <option value="" data-i18n="allHealth">All Health</option>
                    <option value="healthy" data-i18n="healthy">Healthy</option>
                    <option value="warn" data-i18n="warning">Warning</option>
                    <option value="bad" data-i18n="unreachable">Unreachable</option>
                  </select>
                  <button type="button" class="btn btn-sm" id="btn-batch-test" data-i18n="batchTest">Batch Test</button>
                  <button type="button" class="btn btn-sm" id="btn-nodes-refresh" data-i18n="refresh">Refresh</button>
                </div>
                  <div class="table-wrap">
                    <table class="nodes">
                    <thead>
                      <tr>
                        <th data-i18n="colName">Name</th>
                        <th data-i18n="colType">Type</th>
                        <th data-i18n="colAddress">Address</th>
                        <th data-i18n="colSource">Source</th>
                        <th data-i18n="colRoute">Route</th>
                        <th data-i18n="colHealth">Health</th>
                        <th data-i18n="colLatency">Latency</th>
                        <th data-i18n="colWorker">Assigned Worker</th>
                        <th data-i18n="colActions">Actions</th>
                      </tr>
                    </thead>
                    <tbody id="nodes-body"></tbody>
                    </table>
                  </div>
                  <div class="table-foot">
                    <div class="sum" id="nodes-sum"></div>
                    <div class="pager" id="nodes-pager"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="pp-side">
              <!-- Clash Bridge -->
              <div class="panel">
                <div class="panel-hd">
                  <h2 data-i18n="clashBridge">Clash Bridge</h2>
                  <div style="display:flex;align-items:center;gap:8px">
                    <label class="toggle" title="Enable">
                      <input type="checkbox" id="bridgeEnabled" />
                      <span></span>
                    </label>
                    <span class="tag" id="bridge-conn-tag">—</span>
                  </div>
                </div>
                <div class="panel-bd bridge-form">
                  <div class="row">
                    <div>
                      <label class="field" for="bridgeApi" data-i18n="controllerUrl">Controller URL</label>
                      <input class="input" id="bridgeApi" type="text" placeholder="http://127.0.0.1:9090" />
                    </div>
                  </div>
                  <div class="row">
                    <div>
                      <label class="field" for="bridgeSecret" data-i18n="secret">Secret</label>
                      <div class="input-wrap">
                        <input class="input" id="bridgeSecret" type="password" autocomplete="off" style="padding-right:34px" />
                        <button type="button" class="eye" id="btn-toggle-secret" aria-label="Show">👁</button>
                      </div>
                    </div>
                  </div>
                  <div class="row two">
                    <div>
                      <label class="field" for="bridgeHost" data-i18n="localHost">Local Host</label>
                      <input class="input" id="bridgeHost" type="text" placeholder="127.0.0.1" />
                    </div>
                    <div>
                      <label class="field" for="bridgePort" data-i18n="localPort">Local Port</label>
                      <input class="input" id="bridgePort" type="number" placeholder="7890" />
                    </div>
                  </div>
                  <div class="row">
                    <div>
                      <label class="field" for="bridgeGroup" data-i18n="selectorGroup">Selector Group</label>
                      <input class="input" id="bridgeGroup" type="text" placeholder="GLOBAL" />
                    </div>
                  </div>
                  <div class="bridge-actions">
                    <button type="button" class="btn" id="btn-probe-bridge" data-i18n="testConnection">Test Connection</button>
                    <button type="button" class="btn btn-primary" id="btn-save-bridge" data-i18n="saveChanges">Save Changes</button>
                  </div>
                  <button type="button" class="btn" id="btn-import-clash" style="width:100%;margin-top:8px" data-i18n="importController">Import Controller Nodes</button>
                  <div class="probe-ok" id="bridge-probe-msg"></div>
                </div>
              </div>

              <!-- Recent activity -->
              <div class="panel">
                <div class="panel-hd">
                  <h2 data-i18n="recentActivity">Recent Activity</h2>
                </div>
                <div class="panel-bd">
                  <ul class="activity-list" id="activity-list"></ul>
                </div>
              </div>

              <!-- Unassigned -->
              <div class="panel">
                <div class="panel-hd">
                  <h2 data-i18n="unassignedWorkers">Unassigned Workers</h2>
                </div>
                <div class="panel-bd" id="unassigned-box"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Workers -->
        <div class="page" id="page-workers" data-page="workers">
          <div class="page-head">
            <div>
              <h1 data-i18n="navWorkers">Workers</h1>
              <p class="sub" data-i18n="workersSub">API keys and proxy pool bindings for IP isolation.</p>
            </div>
            <div class="page-actions">
              <label class="field" style="margin:0;display:flex;align-items:center;gap:8px">
                <span data-i18n="routingStrategy">Routing strategy</span>
                <select class="select" id="routing-strategy" style="width:auto;min-width:170px">
                  <option value="anonymous_first" data-i18n="anonymousFirst">Anonymous first</option>
                  <option value="authenticated_first" data-i18n="authenticatedFirst">Signed-in first</option>
                  <option value="mixed" data-i18n="mixedStrategy">Mixed</option>
                </select>
              </label>
              <button type="button" class="btn" id="btn-assign-proxies" data-i18n="assignHealthyProxies">Assign healthy proxies</button>
              <button type="button" class="btn" id="btn-toggle-all-workers" data-i18n="collapseAll">Collapse all</button>
              <button type="button" class="btn" id="btn-add-account" data-i18n="addWorker">Add worker</button>
              <button type="button" class="btn btn-danger" id="btn-remove-all-workers" data-i18n="removeAllWorkers">Remove all</button>
              <button type="button" class="btn btn-primary" id="btn-save-accounts" data-i18n="saveWorkers">Save workers</button>
            </div>
          </div>
          <div class="stack workers-stack"><div id="accounts" class="worker-columns"></div></div>
        </div>

        <!-- Client usage -->
        <div class="page" id="page-usage" data-page="usage">
          <div class="page-head">
            <div>
              <h1 data-i18n="navUsage">Client Usage</h1>
              <p class="sub" data-i18n="usageSub">Point any OpenAI-compatible client at this gateway.</p>
            </div>
          </div>
          <div class="usage-box">
            <div><span data-i18n="openaiBase">OpenAI-compatible base</span>: <code id="usage-base">http://127.0.0.1:9876/v1</code></div>
            <div><code>POST /v1/chat/completions</code> · <code>GET /v1/models</code></div>
            <div style="margin-top:8px"><span data-i18n="adminApis">Admin APIs</span>:
              <code>/admin/api/settings</code> ·
              <code>/admin/api/proxy-pool</code> ·
              <code>/admin/api/proxy-subscriptions/:id/fetch</code>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>

  <div class="toast" id="toast">
    <span id="toast-icon">✓</span>
    <span id="toast-msg"></span>
    <button type="button" class="x" id="toast-close">×</button>
  </div>

  <div class="confirm-float" id="confirm-float">
    <button type="button" class="close" id="confirm-x">×</button>
    <h3><span style="color:var(--err)">⚠</span> <span id="confirm-title"></span></h3>
    <p id="confirm-body"></p>
    <p data-i18n="cannotUndo">This action cannot be undone.</p>
    <div class="acts">
      <button type="button" class="btn btn-sm" id="confirm-cancel" data-i18n="cancel">Cancel</button>
      <button type="button" class="btn btn-sm btn-danger" id="confirm-ok" data-i18n="delete">Delete</button>
    </div>
  </div>

  <div class="modal-root" id="modal-proxy">
    <div class="modal form">
      <h3 data-i18n="addProxy">Add Proxy</h3>
      <div class="row two">
        <div>
          <label class="field" for="pxName" data-i18n="colName">Name</label>
          <input class="input" id="pxName" type="text" placeholder="hk-1" />
        </div>
        <div>
          <label class="field" for="pxType" data-i18n="colType">Type</label>
          <select class="select" id="pxType">
            <option value="http">http</option>
            <option value="https">https</option>
            <option value="socks5">socks5</option>
            <option value="socks4">socks4</option>
          </select>
        </div>
      </div>
      <div class="row two">
        <div>
          <label class="field" for="pxHost">Host</label>
          <input class="input" id="pxHost" type="text" placeholder="1.2.3.4" />
        </div>
        <div>
          <label class="field" for="pxPort">Port</label>
          <input class="input" id="pxPort" type="number" placeholder="7890" />
        </div>
      </div>
      <div class="row two">
        <div>
          <label class="field" for="pxUser" data-i18n="usernameOpt">Username (optional)</label>
          <input class="input" id="pxUser" type="text" />
        </div>
        <div>
          <label class="field" for="pxPass" data-i18n="passwordOpt">Password (optional)</label>
          <input class="input" id="pxPass" type="password" autocomplete="off" />
        </div>
      </div>
      <div class="acts">
        <button type="button" class="btn" id="modal-proxy-cancel" data-i18n="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="btn-add-proxy" data-i18n="addToPool">Add to pool</button>
      </div>
    </div>
  </div>

  <div class="modal-root" id="modal-sub">
    <div class="modal form">
      <h3 data-i18n="addSubscription">Add Subscription</h3>
      <div class="row">
        <div>
          <label class="field" for="subName" data-i18n="colName">Name</label>
          <input class="input" id="subName" type="text" placeholder="my-clash" />
        </div>
      </div>
      <div class="row">
        <div>
          <label class="field" for="subUrl" data-i18n="subUrl">Subscription URL</label>
          <input class="input" id="subUrl" type="url" placeholder="https://example.com/clash.yaml" />
        </div>
      </div>
      <div class="acts">
        <button type="button" class="btn" id="modal-sub-cancel" data-i18n="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="btn-add-sub" data-i18n="addSubscription">Add Subscription</button>
      </div>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const VERSION = "1.0.0";

    const I18N = {
      en: {
        navOverview: "Overview", navGateway: "Gateway", navProxy: "Proxy Pool",
        navWorkers: "Workers", navUsage: "Client Usage", selfHosted: "Self-hosted",
        running: "Running", stopped: "Stopped", loading: "Loading…",
        overviewSub: "Gateway health, workers, and proxy pool at a glance.",
        workerUsage: "Worker usage",
        recentAttempts: "Recent upstream attempts",
        recentAttemptsSub: "Retries share the same request ID.",
        resetStats: "Reset stats",
        confirmResetStats: "Reset all worker request and token counters?",
        toastStatsReset: "Worker stats reset",
        colWorkerId: "Worker",
        colIdentity: "Zen identity",
        colRouteEgress: "Route / egress",
        colSuccessErrors: "Success / errors",
        colTokens: "Tokens",
        colCache: "Cache",
        colState: "State",
        colTime: "Time",
        colRequest: "Request",
        colOperation: "Operation",
        colResult: "Result",
        colSwitch: "Switch",
        colRequests: "Requests",
        colChat: "Chat",
        colModels: "Models",
        modelsUsed: "Models used",
        modelsEndpoint: "Model-list requests",
        colPromptTok: "Prompt tokens",
        colCompletionTok: "Completion tokens",
        colTotalTok: "Total tokens",
        colCacheRead: "Cache read",
        colCacheWrite: "Cache write",
        colCacheRate: "Cache rate",
        colLastReq: "Last request",
        totalsLabel: "Totals",
        attemptCount: "upstream attempts",
        retrying: "Retrying",
        returned: "Returned",
        noRetry: "No retry",
        readyState: "Ready",
        coolingState: "Cooling down",
        directEgress: "Direct egress",
        unknownEgress: "Egress unknown",
        noAttempts: "No upstream attempts yet.",
        outcomeSuccess: "Success",
        outcomeRateLimit: "Rate limited",
        outcomeAuthFailed: "Auth failed",
        outcomeUpstreamError: "Upstream error",
        outcomeTransportError: "Network error",
        gatewaySub: "Upstream target, listen port, and CLI identity headers.",
        proxyPoolTitle: "Proxy Pool",
        proxyPoolSub: "Isolate every OpenCode account with a dedicated egress IP.",
        workersSub: "API keys and proxy pool bindings for IP isolation.",
        usageSub: "Point any OpenAI-compatible client at this gateway.",
        addProxy: "Add Proxy", addSubscription: "Add Subscription", pullAll: "Pull All",
        more: "More", refreshAll: "Refresh all", reviewBindings: "Review Bindings",
        saveChanges: "Save Changes", testConnection: "Test Connection",
        importController: "Import Controller Nodes",
        upstreamBaseUrl: "Upstream base URL",
        relayAccessToken: "Relay access token (X-OC-Relay-Key)",
        listenPort: "Listen port (restart to apply)",
        cliUserAgent: "CLI User-Agent",
        synthesizeCli: "Synthesize OpenCode CLI identity headers (VPS / Cloudflare)",
        isoTitle: "IP Isolation Overview",
        colWorker: "Worker / API Key", colProxy: "Proxy Node / Route", colEgress: "Egress IP",
        legUnique: "Unique IP", legShared: "Shared IP", legIssue: "Issue",
        uniqueHealth: "Good isolation health",
        sharedHealth: "Some workers share egress",
        badHealth: "Isolation issues detected",
        ofWorkers: "workers have unique egress IPs",
        subscriptions: "Subscriptions", proxyNodes: "Proxy Nodes",
        searchNodes: "Search nodes...", allProtocols: "All Protocols",
        allSources: "All Sources", allHealth: "All Health",
        healthy: "Healthy", warning: "Warning", unreachable: "Unreachable", testing: "Testing",
        refresh: "Refresh", batchTest: "Batch Test", testNode: "Test",
        zenUnverified: "Zen unverified", zenUsable: "Anonymous Zen usable", zenRateLimited: "Zen rate limited",
        zenTemporary: "Zen temporary failure", zenBlocked: "Zen blocked", zenUnreachable: "Zen unreachable",
        colName: "Name", colType: "Type", colAddress: "Address",
        colSource: "Source", colRoute: "Route", colHealth: "Health", colLatency: "Latency",
        colActions: "Actions", clashBridge: "Clash Bridge",
        timeout: "Timeout", notTested: "—",
        toastBatchDone: (ok, fail, skip) => "Batch test done · ok " + ok + " · fail " + fail + (skip ? " · skip " + skip : ""),
        toastBatchWorkers: (n) => n + " anonymous worker(s) added",
        toastTestOk: (name, ms) => "Proxy test succeeded · " + name + " · " + ms + "ms",
        toastTestFail: (name, err) => "Proxy test failed · " + name + (err ? " · " + err : ""),
        toastTesting: "Testing nodes…",
        controllerUrl: "Controller URL", secret: "Secret",
        localHost: "Local Host", localPort: "Local Port", selectorGroup: "Selector Group",
        recentActivity: "Recent Activity", unassignedWorkers: "Unassigned Workers",
        allAssigned: "All workers are assigned", greatJob: "Great job!",
        noUnassigned: "All workers are assigned",
        unassignedCount: (n) => n + " worker(s) without a pool binding",
        openaiBase: "OpenAI-compatible base", adminApis: "Admin APIs",
        addWorker: "Add worker", saveWorkers: "Save workers", removeAllWorkers: "Remove all",
        removeGroupWorkers: "Clear group",
        anonymousWorkers: "Anonymous Zen", authenticatedWorkers: "Signed-in Zen",
        noAnonymousWorkers: "No anonymous Workers", noAuthenticatedWorkers: "No signed-in Workers",
        confirmRemoveAllWorkers: "Remove all Workers?",
        confirmRemoveAllWorkersBody: "All Workers will be removed from this form. Save Workers to apply the change.",
        toastWorkersCleared: "All Workers removed from the form — save to apply",
        confirmRemoveWorkerGroup: (name) => "Remove all " + name + " Workers?",
        confirmRemoveWorkerGroupBody: (name) => "All " + name + " Workers will be removed from this form. Save Workers to apply the change.",
        toastWorkerGroupCleared: (name) => name + " Workers removed from the form — save to apply",
        testWorker: "Test connection", testingWorker: "Testing…",
        saveBeforeWorkerTest: "Save this worker before testing",
        workerTestOk: "Connection succeeded", workerTestFail: "Connection failed",
        assignHealthyProxies: "Assign healthy proxies",
        toastAssignProxies: (assigned, total, healthy) =>
          "Assigned " + assigned + "/" + total + " workers · " + healthy + " healthy proxies available",
        toastAssignNoHealthy: "No healthy proxies — run Batch Test on the proxy pool first",
        toastAssignFail: "Auto-assign failed",
        remove: "Remove", idLabel: "Id / label", apiKey: "API key (Bearer)",
        workerKind: "Zen access", anonymousZen: "Anonymous Zen (public)", authenticatedZen: "Signed-in Zen key",
        routingStrategy: "Routing strategy", anonymousFirst: "Anonymous first",
        authenticatedFirst: "Signed-in first", mixedStrategy: "Mixed",
        workerEnabled: "Receive traffic", disabledState: "Disabled",
        collapse: "Collapse", expand: "Expand", collapseAll: "Collapse all", expandAll: "Expand all",
        bindProxy: "Bind pool node",
        directNoProxy: "(direct / no proxy)",
        tagDirect: "[direct] ", tagBridge: "[Clash bridge] ",
        tagNeedBridge: "[need bridge] ", tagUnusable: "[unusable] ",
        noWorkers: "No workers configured. Run Batch Test to add anonymous Workers, or add a signed-in Worker manually.",
        noSubs: "No subscriptions yet. Add a Clash subscription to import nodes.",
        neverFetched: "Never pulled",
        lastPulled: "Last pulled",
        nodes: "nodes",
        pull: "Pull", del: "Delete",
        srcManual: "Manual", srcSub: "Subscription", srcController: "Controller",
        toastControllerImported: (n, group) => "Imported " + n + " nodes from " + group,
        routeDirect: "Direct", routeBridge: "Clash Bridge", routeNeedBridge: "Bridge Required",
        unassigned: "Unassigned", enableBridge: "Enable Bridge",
        noActivity: "No recent activity",
        recentErrors: "Recent errors", none: "None",
        cancel: "Cancel", delete: "Delete", cannotUndo: "This action cannot be undone.",
        confirmDelSub: "Delete subscription?",
        confirmDelSubBody: (name) => 'This will permanently delete "' + name + '" and remove its imported proxies.',
        confirmDelProxy: "Delete proxy?",
        confirmDelProxyBody: (name) => 'Remove "' + name + '" from the proxy pool?',
        toastDelFail: "Delete failed",
        toastSubDeleted: "Subscription deleted",
        toastProxyDeleted: "Proxy removed",
        toastBridgeSaved: "Clash bridge saved",
        toastProbing: "Testing connection…",
        toastClashOk: "Connection successful",
        toastClashFail: "Connection failed",
        toastSaveFail: "Save failed",
        toastGatewaySaved: "Gateway settings saved",
        toastWorkersSaved: "Workers saved",
        toastHostPort: "Host and port are required",
        toastAddFail: "Add failed",
        toastAddedPool: "Proxy pool updated successfully",
        toastSubUrlReq: "Subscription URL required",
        toastSubAdded: "Subscription added — click Pull",
        toastFetchDone: (ok, total) => "Fetch complete ok=" + ok + "/" + total,
        toastImported: (n) => "Imported " + n + " nodes",
        toastRefreshed: "Refreshed",
        toastCopied: "Copied",
        connected: "Connected", disconnected: "Disconnected", enabled: "Enabled", disabled: "Disabled",
        useLightTheme: "Use light theme", useDarkTheme: "Use dark theme",
        batchProgress: (done, total) => "Verifying nodes " + done + "/" + total,
        batchScreening: (done, total) => "Screening nodes " + done + "/" + total,
        metricGateway: "Gateway", metricWorkers: "Workers", metricProxyNodes: "Proxy Nodes",
        metricDirect: "Direct Nodes", metricBridged: "Bridged Nodes", metricClash: "Clash Bridge",
        total: "total", ready: "ready", busy: "Busy",
        usernameOpt: "Username (optional)", passwordOpt: "Password (optional)",
        addToPool: "Add to pool", subUrl: "Subscription URL",
        sharedIp: "Shared IP", multipleWorkers: "Multiple Workers",
        noProxy: "No proxy", directRoute: "Direct · Shared Route",
        lastUpdated: "Last updated: just now",
        poolEmpty: "No proxy nodes yet",
        nodesSum: (n, h, w, b) => n + " nodes · " + h + " healthy · " + w + " require bridge · " + b + " unavailable",
      },
      zh: {
        navOverview: "总览", navGateway: "网关", navProxy: "代理池",
        navWorkers: "Workers", navUsage: "客户端用法", selfHosted: "自托管",
        running: "运行中", stopped: "已停止", loading: "加载中…",
        overviewSub: "网关健康、Worker 与代理池一览。",
        workerUsage: "Worker 用量",
        recentAttempts: "最近上游尝试",
        recentAttemptsSub: "自动重试会使用相同的请求编号。",
        resetStats: "重置统计",
        confirmResetStats: "重置全部 Worker 的请求次数与 token 计数？",
        toastStatsReset: "Worker 统计已重置",
        colWorkerId: "Worker",
        colIdentity: "Zen 身份",
        colRouteEgress: "节点 / 出口",
        colSuccessErrors: "成功 / 失败",
        colTokens: "Tokens",
        colCache: "缓存",
        colState: "状态",
        colTime: "时间",
        colRequest: "请求",
        colOperation: "操作",
        colResult: "结果",
        colSwitch: "切换",
        colRequests: "请求次数",
        colChat: "Chat",
        colModels: "Models",
        modelsUsed: "使用模型",
        modelsEndpoint: "模型列表请求",
        colPromptTok: "输入 tokens",
        colCompletionTok: "输出 tokens",
        colTotalTok: "总 tokens",
        colCacheRead: "缓存读取",
        colCacheWrite: "缓存写入",
        colCacheRate: "缓存率",
        colLastReq: "最近请求",
        totalsLabel: "合计",
        attemptCount: "次上游尝试",
        retrying: "继续切换",
        returned: "已返回",
        noRetry: "未切换",
        readyState: "可用",
        coolingState: "冷却中",
        directEgress: "直连出口",
        unknownEgress: "出口未知",
        noAttempts: "暂无上游请求记录。",
        outcomeSuccess: "成功",
        outcomeRateLimit: "已限流",
        outcomeAuthFailed: "认证失败",
        outcomeUpstreamError: "上游错误",
        outcomeTransportError: "网络错误",
        gatewaySub: "上游地址、监听端口与 CLI 身份头。",
        proxyPoolTitle: "代理池",
        proxyPoolSub: "为每个 OpenCode 账号隔离独立出口 IP。",
        workersSub: "API Key 与代理池绑定，实现 IP 隔离。",
        usageSub: "将任意 OpenAI 兼容客户端指向本网关。",
        addProxy: "添加代理", addSubscription: "添加订阅", pullAll: "拉取全部",
        more: "更多", refreshAll: "全部刷新", reviewBindings: "检查绑定",
        saveChanges: "保存更改", testConnection: "测试连接",
        importController: "导入 Controller 节点",
        upstreamBaseUrl: "上游 Base URL",
        relayAccessToken: "网关访问令牌（X-OC-Relay-Key）",
        listenPort: "监听端口（需重启生效）",
        cliUserAgent: "CLI User-Agent",
        synthesizeCli: "合成 OpenCode CLI 身份头（VPS / Cloudflare）",
        isoTitle: "IP 隔离概览",
        colWorker: "Worker / API Key", colProxy: "代理节点 / 路由", colEgress: "出口 IP",
        legUnique: "独立 IP", legShared: "共享 IP", legIssue: "异常",
        uniqueHealth: "隔离状态良好",
        sharedHealth: "部分 Worker 共享出口",
        badHealth: "检测到隔离问题",
        ofWorkers: "个 Worker 拥有独立出口 IP",
        subscriptions: "订阅", proxyNodes: "代理节点",
        searchNodes: "搜索节点…", allProtocols: "全部协议",
        allSources: "全部来源", allHealth: "全部健康状态",
        healthy: "健康", warning: "警告", unreachable: "不可达", testing: "测试中",
        refresh: "刷新", batchTest: "批量测试", testNode: "测试",
        zenUnverified: "Zen 未验证", zenUsable: "匿名 Zen 可用", zenRateLimited: "Zen 已限流",
        zenTemporary: "Zen 临时故障", zenBlocked: "Zen 已阻止", zenUnreachable: "Zen 不可达",
        colName: "名称", colType: "类型", colAddress: "地址",
        colSource: "来源", colRoute: "路由", colHealth: "健康", colLatency: "延迟",
        colActions: "操作", clashBridge: "Clash 桥接",
        timeout: "超时", notTested: "—",
        toastBatchDone: (ok, fail, skip) => "批量测试完成 · 成功 " + ok + " · 失败 " + fail + (skip ? " · 跳过 " + skip : ""),
        toastBatchWorkers: (n) => "已自动添加 " + n + " 个匿名 Worker",
        toastTestOk: (name, ms) => "代理测试成功 · " + name + " · " + ms + "ms",
        toastTestFail: (name, err) => "代理测试失败 · " + name + (err ? " · " + err : ""),
        toastTesting: "正在测试节点…",
        controllerUrl: "控制器 URL", secret: "密钥",
        localHost: "本地主机", localPort: "本地端口", selectorGroup: "选择器分组",
        recentActivity: "最近活动", unassignedWorkers: "未绑定 Worker",
        allAssigned: "所有 Worker 均已绑定", greatJob: "很好！",
        noUnassigned: "所有 Worker 均已绑定",
        unassignedCount: (n) => n + " 个 Worker 未绑定代理",
        openaiBase: "OpenAI 兼容 Base", adminApis: "管理 API",
        addWorker: "添加 Worker", saveWorkers: "保存 Workers", removeAllWorkers: "一键删除",
        removeGroupWorkers: "清空此列",
        anonymousWorkers: "匿名 Zen", authenticatedWorkers: "登录 Zen",
        noAnonymousWorkers: "暂无匿名 Worker", noAuthenticatedWorkers: "暂无登录 Zen Worker",
        confirmRemoveAllWorkers: "删除全部 Workers？",
        confirmRemoveAllWorkersBody: "将从当前表单移除全部 Worker，点击保存 Workers 后生效。",
        toastWorkersCleared: "已从表单移除全部 Workers，请保存后生效",
        confirmRemoveWorkerGroup: (name) => "删除全部" + name + " Workers？",
        confirmRemoveWorkerGroupBody: (name) => "将从当前表单移除全部" + name + " Worker，点击保存 Workers 后生效。",
        toastWorkerGroupCleared: (name) => "已从表单移除全部" + name + " Workers，请保存后生效",
        testWorker: "测试连接", testingWorker: "测试中…",
        saveBeforeWorkerTest: "请先保存此 Worker 再测试",
        workerTestOk: "连接成功", workerTestFail: "连接失败",
        assignHealthyProxies: "一键分配健康代理",
        toastAssignProxies: (assigned, total, healthy) =>
          "已为 " + assigned + "/" + total + " 个 Worker 分配代理 · 可用健康代理 " + healthy,
        toastAssignNoHealthy: "没有健康代理 — 请先在代理池执行批量测试",
        toastAssignFail: "一键分配失败",
        remove: "移除", idLabel: "Id / 标签", apiKey: "API Key（Bearer）",
        workerKind: "Zen 访问类型", anonymousZen: "匿名 Zen（public）", authenticatedZen: "登录 Zen Key",
        routingStrategy: "调度策略", anonymousFirst: "匿名优先",
        authenticatedFirst: "登录 Zen 优先", mixedStrategy: "混合轮询",
        workerEnabled: "参与流量调度", disabledState: "已禁用",
        collapse: "折叠", expand: "展开", collapseAll: "全部折叠", expandAll: "全部展开",
        bindProxy: "绑定代理池节点",
        directNoProxy: "（直连 / 无代理）",
        tagDirect: "[直连] ", tagBridge: "[Clash桥接] ",
        tagNeedBridge: "[需开桥接] ", tagUnusable: "[不可用] ",
        noWorkers: "暂无 Worker。可运行批量测试自动添加匿名 Worker，或手动添加登录 Zen Worker。",
        noSubs: "暂无订阅。添加 Clash 订阅以导入节点。",
        neverFetched: "从未拉取",
        lastPulled: "上次拉取",
        nodes: "节点",
        pull: "拉取", del: "删除",
        srcManual: "手动", srcSub: "订阅", srcController: "Controller",
        toastControllerImported: (n, group) => "已从 " + group + " 导入 " + n + " 个节点",
        routeDirect: "直连", routeBridge: "Clash 桥接", routeNeedBridge: "需开桥接",
        unassigned: "未分配", enableBridge: "启用桥接",
        noActivity: "暂无活动",
        recentErrors: "最近错误", none: "无",
        cancel: "取消", delete: "删除", cannotUndo: "此操作不可撤销。",
        confirmDelSub: "删除订阅？",
        confirmDelSubBody: (name) => "将永久删除「" + name + "」并移除其导入的代理。",
        confirmDelProxy: "删除代理？",
        confirmDelProxyBody: (name) => "从代理池移除「" + name + "」？",
        toastDelFail: "删除失败",
        toastSubDeleted: "订阅已删除",
        toastProxyDeleted: "代理已移除",
        toastBridgeSaved: "Clash 桥接已保存",
        toastProbing: "正在测试连接…",
        toastClashOk: "连接成功",
        toastClashFail: "连接失败",
        toastSaveFail: "保存失败",
        toastGatewaySaved: "网关设置已保存",
        toastWorkersSaved: "Workers 已保存",
        toastHostPort: "需要 Host 与 Port",
        toastAddFail: "添加失败",
        toastAddedPool: "代理池已更新",
        toastSubUrlReq: "订阅 URL 必填",
        toastSubAdded: "订阅已添加，请点击拉取",
        toastFetchDone: (ok, total) => "拉取完成 ok=" + ok + "/" + total,
        toastImported: (n) => "已导入 " + n + " 个节点",
        toastRefreshed: "已刷新",
        toastCopied: "已复制",
        connected: "已连接", disconnected: "未连接", enabled: "已启用", disabled: "已关闭",
        useLightTheme: "切换到浅色模式", useDarkTheme: "切换到深色模式",
        batchProgress: (done, total) => "正在验证节点 " + done + "/" + total,
        batchScreening: (done, total) => "正在筛选节点 " + done + "/" + total,
        metricGateway: "网关", metricWorkers: "Workers", metricProxyNodes: "代理节点",
        metricDirect: "直连节点", metricBridged: "桥接节点", metricClash: "Clash 桥接",
        total: "总计", ready: "就绪", busy: "忙碌",
        usernameOpt: "用户名（可选）", passwordOpt: "密码（可选）",
        addToPool: "加入代理池", subUrl: "订阅 URL",
        sharedIp: "共享 IP", multipleWorkers: "多个 Worker",
        noProxy: "无代理", directRoute: "直连 · 共享路由",
        lastUpdated: "刚刚更新",
        poolEmpty: "暂无代理节点",
        nodesSum: (n, h, w, b) => n + " 节点 · " + h + " 健康 · " + w + " 需桥接 · " + b + " 不可用",
      },
    };

    function storageGet(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    }

    function storageSet(key, value) {
      try { localStorage.setItem(key, value); } catch { /* storage may be unavailable */ }
    }

    let lang = storageGet("ocfr-lang") || "en";
    if (lang !== "en" && lang !== "zh") lang = "en";
    let settings = null;
    let status = null;
    const workerTestingIds = new Set();
    const workerTestResults = new Map();
    let collapsedWorkerIds = readCollapsedWorkerIds();
    let page = storageGet("ocfr-page") || "proxy";
    let nodePage = 1;
    const PAGE_SIZE = 8;
    let confirmCb = null;
    let bridgeProbeOk = null;
    /** @type {Record<string, { ok:boolean, latencyMs:number|null, error:string|null, health:string, testedAt?:string, skipped?:boolean }>} */
    let probeResults = {};
    /** @type {Set<string>} */
    const testingIds = new Set();
    let batchTesting = false;
    let batchProgressTimer = null;
    let batchRequestActive = false;
    let batchProgressSeenRunning = false;
    let batchProgress = null;
    let lastBatchRenderedWorkerCount = 0;
    let serverAccountIds = new Set();
    let batchBaselineAccountIds = new Set();
    let recentProbeEvents = [];

    function t(key) {
      const pack = I18N[lang] || I18N.en;
      const v = pack[key];
      if (v != null) return v;
      return I18N.en[key] != null ? I18N.en[key] : key;
    }

    function readCollapsedWorkerIds() {
      try {
        const value = JSON.parse(storageGet("ocfr-collapsed-workers") || "[]");
        return new Set(Array.isArray(value) ? value.map(String) : []);
      } catch {
        return new Set();
      }
    }

    function persistCollapsedWorkers() {
      storageSet("ocfr-collapsed-workers", JSON.stringify([...collapsedWorkerIds]));
    }

    function syncCollapseToggle(btn, collapsed) {
      const target = $(btn.dataset.collapseTarget);
      if (!target) return;
      target.classList.toggle("is-collapsed", collapsed);
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.title = t(collapsed ? "expand" : "collapse");
      const icon = btn.querySelector("span");
      if (icon) icon.textContent = collapsed ? "▾" : "▴";
    }

    function initSectionCollapsibles() {
      document.querySelectorAll(".collapse-toggle[data-collapse-key]").forEach((btn) => {
        const storageKey = "ocfr-collapse-" + btn.dataset.collapseKey;
        syncCollapseToggle(btn, storageGet(storageKey) === "1");
        btn.onclick = () => {
          const collapsed = btn.getAttribute("aria-expanded") === "true";
          storageSet(storageKey, collapsed ? "1" : "0");
          syncCollapseToggle(btn, collapsed);
        };
      });
    }

    function applyStaticI18n() {
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const val = t(el.getAttribute("data-i18n"));
        if (typeof val === "string") el.textContent = val;
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const val = t(el.getAttribute("data-i18n-placeholder"));
        if (typeof val === "string") el.placeholder = val;
      });
      // refresh filter option labels
      const fp = $("flt-proto");
      if (fp && fp.options[0]) fp.options[0].textContent = t("allProtocols");
      const fs = $("flt-source");
      if (fs) {
        if (fs.options[0]) fs.options[0].textContent = t("allSources");
        if (fs.options[1]) fs.options[1].textContent = t("srcManual");
        if (fs.options[2]) fs.options[2].textContent = t("srcSub");
        if (fs.options[3]) fs.options[3].textContent = t("srcController");
      }
      const fh = $("flt-health");
      if (fh) {
        if (fh.options[0]) fh.options[0].textContent = t("allHealth");
        if (fh.options[1]) fh.options[1].textContent = t("healthy");
        if (fh.options[2]) fh.options[2].textContent = t("warning");
        if (fh.options[3]) fh.options[3].textContent = t("unreachable");
      }
      $("lang-en").classList.toggle("active", lang === "en");
      $("lang-zh").classList.toggle("active", lang === "zh");
      syncThemeControl();
      document.querySelectorAll(".collapse-toggle[data-collapse-key]").forEach((btn) => {
        syncCollapseToggle(btn, btn.getAttribute("aria-expanded") !== "true");
      });
    }

    function currentTheme() {
      return document.documentElement.dataset.theme === "light" ? "light" : "dark";
    }

    function syncThemeControl() {
      const light = currentTheme() === "light";
      const btn = $("btn-theme");
      const label = t(light ? "useDarkTheme" : "useLightTheme");
      btn.title = label;
      btn.setAttribute("aria-label", label);
      $("theme-icon").textContent = light ? "☾" : "☀";
    }

    function toggleTheme() {
      const next = currentTheme() === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      storageSet("ocfr-theme", next);
      syncThemeControl();
    }

    function setLang(next) {
      lang = next;
      storageSet("ocfr-lang", lang);
      applyStaticI18n();
      if (settings) renderAll();
    }

    function toast(msg, ok = true) {
      const el = $("toast");
      $("toast-msg").textContent = msg;
      $("toast-icon").textContent = ok ? "✓" : "!";
      el.className = "toast show " + (ok ? "ok" : "fail");
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { el.className = "toast"; }, 3200);
    }
    $("toast-close").onclick = () => { $("toast").className = "toast"; };

    function escapeAttr(s) {
      return String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
    }
    function escapeHtml(s) {
      return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    function maskKey(k) {
      const s = String(k || "");
      if (!s) return "—";
      if (s.length <= 10) return s.slice(0, 2) + "…" + s.slice(-2);
      return s.slice(0, 6) + "…" + s.slice(-4);
    }

    function relTime(iso) {
      if (!iso) return t("neverFetched");
      const d = new Date(iso).getTime();
      if (Number.isNaN(d)) return iso;
      const sec = Math.max(0, Math.round((Date.now() - d) / 1000));
      if (sec < 60) return sec + "s ago";
      if (sec < 3600) return Math.round(sec / 60) + " min ago";
      if (sec < 86400) return Math.round(sec / 3600) + " h ago";
      return Math.round(sec / 86400) + " d ago";
    }

    function sparkSvg(seed, color) {
      const pts = [];
      let y = 12;
      for (let i = 0; i < 12; i++) {
        y = Math.max(3, Math.min(19, y + Math.sin(seed + i * 0.9) * 3 + ((seed * (i + 1)) % 5) - 2));
        pts.push((i * 6) + "," + y.toFixed(1));
      }
      return '<svg class="spark" viewBox="0 0 66 22" preserveAspectRatio="none"><polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + pts.join(" ") + '"/></svg>';
    }

    function bridgeOn() {
      return !!(settings && settings.clashBridge && settings.clashBridge.enabled);
    }

    function proxyById(id) {
      return (settings.proxyPool || []).find((p) => p.id === id) || null;
    }

    function structuralHealth(p) {
      if (!p || !p.enabled) return "bad";
      if (p.usable) return "healthy";
      if (p.bridgeable) return bridgeOn() ? "healthy" : "warn";
      return "bad";
    }

    function nodeHealth(p) {
      if (!p) return "bad";
      if (testingIds.has(p.id)) return "testing";
      const pr = probeResults[p.id];
      if (pr && pr.health) {
        if (pr.health === "healthy" || pr.health === "warn" || pr.health === "bad") return pr.health;
        if (pr.skipped && pr.reason === "bridge_required") return "warn";
      }
      const structural = structuralHealth(p);
      return structural === "healthy" ? "warn" : structural;
    }

    function anonymousZenTag(p) {
      const result = probeResults[p.id]?.anonymousZen;
      if (!result) return '<span class="tag">' + escapeHtml(t("zenUnverified")) + '</span>';
      if (result.status === "usable") return '<span class="tag ok">' + escapeHtml(t("zenUsable")) + '</span>';
      if (result.status === "rate_limited") return '<span class="tag warn">' + escapeHtml(t("zenRateLimited")) + '</span>';
      if (result.status === "temporary_failure") return '<span class="tag warn">' + escapeHtml(t("zenTemporary")) + '</span>';
      return '<span class="tag err">' + escapeHtml(result.status === "blocked" ? t("zenBlocked") : t("zenUnreachable")) + '</span>';
    }

    function latencyCell(p) {
      if (testingIds.has(p.id)) {
        return '<span class="lat muted"><span class="spin"></span>' + escapeHtml(t("testing")) + '</span>';
      }
      const pr = probeResults[p.id];
      if (!pr) return '<span class="lat muted">' + escapeHtml(t("notTested")) + '</span>';
      if (pr.ok && pr.latencyMs != null) {
        return '<span class="lat ok">' + pr.latencyMs + ' ms</span>';
      }
      if (pr.skipped && pr.reason === "bridge_required") {
        return '<span class="lat muted">—</span>';
      }
      const err = pr.error === "Timeout" ? t("timeout") : (pr.error || t("unreachable"));
      return '<span class="lat err" title="' + escapeAttr(pr.error || "") + '">' + escapeHtml(err) + '</span>';
    }

    function pushProbeEvent(result, name) {
      recentProbeEvents.unshift({
        ok: !!result.ok,
        skipped: !!result.skipped,
        name: name || result.id,
        latencyMs: result.latencyMs,
        error: result.error,
        at: result.testedAt || new Date().toISOString(),
      });
      recentProbeEvents = recentProbeEvents.slice(0, 12);
    }

    function nodeRoute(p) {
      if (!p) return { key: "direct", label: t("routeDirect"), cls: "info" };
      if (p.usable) return { key: "direct", label: t("routeDirect"), cls: "ok" };
      if (p.bridgeable) {
        if (bridgeOn()) return { key: "bridge", label: t("routeBridge"), cls: "blue" };
        return { key: "need", label: t("routeNeedBridge"), cls: "warn" };
      }
      return { key: "bad", label: t("unreachable"), cls: "err" };
    }

    function assignedWorkers(proxyId) {
      return (settings.accounts || []).filter((a) => a.proxyId === proxyId);
    }

    function isolationRows() {
      const accounts = settings.accounts || [];
      const routeCount = {};
      for (const a of accounts) {
        const probe = a.proxyId ? probeResults[a.proxyId] : null;
        const k = probe?.egressIp || a.proxyId || "__direct__";
        routeCount[k] = (routeCount[k] || 0) + 1;
      }
      return accounts.map((a, idx) => {
        const p = a.proxyId ? proxyById(a.proxyId) : null;
        const probe = a.proxyId ? probeResults[a.proxyId] : null;
        const key = probe?.egressIp || a.proxyId || "__direct__";
        const shared = routeCount[key] > 1;
        let state = "ok";
        if (!p) state = shared || accounts.length > 1 ? "warn" : "warn";
        else if (nodeHealth(p) === "bad") state = "err";
        else if (nodeHealth(p) === "warn") state = "warn";
        else if (shared) state = "warn";
        return { a, idx, p, probe, shared, state };
      });
    }

    function showPage(name) {
      page = name;
      storageSet("ocfr-page", page);
      document.querySelectorAll(".nav-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.page === page);
      });
      document.querySelectorAll(".page").forEach((el) => {
        el.classList.toggle("active", el.dataset.page === page);
      });
    }

    function renderMetrics(targetId) {
      const st = status || {};
      const pool = settings.proxyPool || [];
      const direct = pool.filter((p) => p.usable).length;
      const bridged = pool.filter((p) => !p.usable && p.bridgeable).length;
      const total = pool.length;
      const ready = st.readyAccountCount ?? 0;
      const workers = st.accountCount ?? (settings.accounts || []).length;
      const enabledWorkers = st.enabledAccountCount ?? workers;
      const busy = Math.max(0, enabledWorkers - ready);
      const pct = enabledWorkers ? Math.round((ready / enabledWorkers) * 100) : 0;
      const running = !!st.running;
      const clashOn = !!st.clashBridgeEnabled || bridgeOn();

      const html = [
        { k: t("metricGateway"), v: running ? t("running") : t("stopped"), vcls: running ? "ok" : "", foot: running ? '<span class="tag ok">' + escapeHtml(t("healthy")) + '</span>' + sparkSvg(1, "#22c55e") : '<span class="tag err">' + escapeHtml(t("stopped")) + '</span>' },
        { k: t("metricWorkers"), v: workers + " " + t("total") + ", " + enabledWorkers + " " + t("enabled"), vcls: "", foot: '<div class="donut-wrap"><div class="donut" style="--p:' + pct + '%" data-pct="' + pct + '%"></div><div class="legend-dots"><span class="r">' + ready + " " + t("ready") + '</span><span class="b">' + busy + " " + t("busy") + '</span></div></div>' },
        { k: t("metricProxyNodes"), v: total + " " + t("total"), vcls: "blue", foot: sparkSvg(2, "#3b82f6") },
        { k: t("metricDirect"), v: String(direct), vcls: "blue", foot: sparkSvg(3, "#60a5fa") },
        { k: t("metricBridged"), v: String(bridged), vcls: "blue", foot: sparkSvg(4, "#3b82f6") },
        { k: t("metricClash"), v: clashOn ? t("enabled") : t("disabled"), vcls: clashOn ? "ok" : "", foot: clashOn ? '<span class="tag ok">' + escapeHtml(bridgeProbeOk === false ? t("disconnected") : t("connected")) + '</span>' : '<span class="tag">' + escapeHtml(t("disabled")) + '</span>' },
      ].map((m) => '<div class="metric"><div class="k">' + escapeHtml(m.k) + '</div><div class="v ' + m.vcls + '">' + escapeHtml(m.v) + '</div><div class="foot">' + m.foot + '</div></div>').join("");
      $(targetId).innerHTML = html;
    }

    function renderIsolation() {
      const rows = isolationRows();
      const root = $("iso-rows");
      if (!rows.length) {
        root.innerHTML = '<p class="hint">' + escapeHtml(t("noWorkers")) + '</p>';
      } else {
        root.innerHTML = rows.map(({ a, idx, p, probe, shared, state }) => {
          const route = p ? nodeRoute(p) : { label: t("directRoute"), key: "direct" };
          const showBridge = p && p.bridgeable && !p.usable;
          const egressCls = shared || !p ? "shared" : "";
          const egressTitle = !p
            ? t("sharedIp")
            : (shared ? t("sharedIp") : (probe?.egressIp || "—"));
          const egressSub = !p
            ? t("multipleWorkers")
            : (shared ? t("multipleWorkers") : (probe?.egressIp ? (p.type + " · " + p.port) : t("notTested")));
          const midName = p ? p.name : t("noProxy");
          const midSub = p
            ? ((p.clashType || p.type) + (p.usable ? " · " + t("routeDirect") : showBridge ? " · " + (p.clashType || p.type) : ""))
            : t("directRoute");
          return '<div class="iso-row">' +
            '<div class="iso-node"><div class="t"><i class="dot ' + state + '"></i>' + escapeHtml(a.id || ("Worker " + (idx + 1))) + '</div><div class="s">' + escapeHtml(maskKey(a.apiKey)) + '</div></div>' +
            '<div class="iso-arrow">→</div>' +
            '<div class="iso-node"><div class="t">' + escapeHtml(midName) + '</div><div class="s">' + escapeHtml(midSub) + '</div>' +
            (showBridge ? '<div style="margin-top:4px"><span class="bridge-chip">' + escapeHtml(t("routeBridge")) + '</span></div>' : '') +
            '</div>' +
            '<div class="iso-arrow">→</div>' +
            '<div class="iso-node ' + egressCls + '"><div class="t">' + escapeHtml(egressTitle) + '</div><div class="s">' + escapeHtml(egressSub) + '</div></div>' +
            '</div>';
        }).join("");
      }

      const unique = rows.filter((r) => r.state === "ok" && !r.shared && r.p).length;
      const total = rows.length || 1;
      const issues = rows.filter((r) => r.state === "err").length;
      const sharedN = rows.filter((r) => r.state === "warn").length;
      let level = "ok", statusTxt = t("uniqueHealth"), shieldCls = "";
      if (issues) { level = "err"; statusTxt = t("badHealth"); shieldCls = "err"; }
      else if (sharedN || unique < rows.length) { level = "warn"; statusTxt = t("sharedHealth"); shieldCls = "warn"; }

      $("iso-health").innerHTML =
        '<div class="big">' + unique + ' <span>of ' + rows.length + '</span></div>' +
        '<div class="desc">' + escapeHtml(t("ofWorkers")) + '</div>' +
        '<div class="shield ' + shieldCls + '">' + (level === "ok" ? "✓" : level === "warn" ? "!" : "×") + '</div>' +
        '<div class="status-txt ' + (level === "ok" ? "" : level) + '">' + escapeHtml(statusTxt) + '</div>' +
        '<button type="button" class="btn btn-sm" id="btn-review-bind" style="border-color:var(--blue-border);color:var(--blue-hi)">' + escapeHtml(t("reviewBindings")) + '</button>';
      const btn = $("btn-review-bind");
      if (btn) btn.onclick = () => showPage("workers");
      $("iso-updated").textContent = t("lastUpdated");
    }

    function renderSubs() {
      const list = settings.proxySubscriptions || [];
      const root = $("sub-grid");
      if (!list.length) {
        root.innerHTML = '<p class="hint">' + escapeHtml(t("noSubs")) + '</p>';
        return;
      }
      root.innerHTML = list.map((s) => {
        const ok = !s.lastError && s.lastFetchedAt;
        const err = !!s.lastError;
        const protos = [];
        const pool = (settings.proxyPool || []).filter((p) => p.subscriptionId === s.id);
        const types = [...new Set(pool.map((p) => (p.clashType || p.type || "").toUpperCase()).filter(Boolean))];
        return '<div class="sub-card' + (err ? ' err' : '') + '">' +
          '<div class="top"><div class="name">' + escapeHtml(s.name) + '</div>' +
          (err ? '<span class="tag err">Error</span>' : ok ? '<span class="tag ok">OK</span>' : '<span class="tag">—</span>') +
          '</div>' +
          '<div class="url"><span title="' + escapeAttr(s.url) + '">' + escapeHtml(s.url) + '</span>' +
          '<button type="button" class="btn btn-sm btn-icon btn-copy-url" data-url="' + escapeAttr(s.url) + '" title="Copy">⧉</button></div>' +
          '<div class="meta"><span>' + escapeHtml(t("lastPulled") + ": " + relTime(s.lastFetchedAt)) + '</span>' +
          '<span>' + (s.lastImportCount || pool.length || 0) + ' ' + escapeHtml(t("nodes")) + '</span></div>' +
          (types.length ? '<div class="proto">' + escapeHtml(types.slice(0, 5).join(", ")) + '</div>' : '') +
          (err ? '<div class="err-msg">' + escapeHtml(s.lastError) + '</div>' : '') +
          '<div class="acts">' +
          '<button type="button" class="btn btn-sm btn-fetch-sub" data-id="' + escapeAttr(s.id) + '">' + escapeHtml(t("pull")) + '</button>' +
          '<button type="button" class="btn btn-sm btn-danger btn-del-sub" data-id="' + escapeAttr(s.id) + '" data-name="' + escapeAttr(s.name) + '">' + escapeHtml(t("del")) + '</button>' +
          '</div></div>';
      }).join("");

      root.querySelectorAll(".btn-copy-url").forEach((btn) => {
        btn.onclick = async () => {
          try { await navigator.clipboard.writeText(btn.dataset.url); toast(t("toastCopied")); }
          catch { toast(btn.dataset.url); }
        };
      });
      root.querySelectorAll(".btn-fetch-sub").forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            const res = await fetch("/admin/api/proxy-subscriptions/" + encodeURIComponent(btn.dataset.id) + "/fetch", { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
            settings = data.settings;
            renderAll();
            toast(t("toastImported")(data.totalCount ?? data.usableCount ?? 0), (data.totalCount ?? data.usableCount) > 0);
          } catch (e) {
            toast(String(e.message || e), false);
            await loadSettings();
            renderAll();
          } finally { btn.disabled = false; }
        };
      });
      root.querySelectorAll(".btn-del-sub").forEach((btn) => {
        btn.onclick = () => {
          openConfirm(t("confirmDelSub"), t("confirmDelSubBody")(btn.dataset.name), async () => {
            const res = await fetch("/admin/api/proxy-subscriptions/" + encodeURIComponent(btn.dataset.id), { method: "DELETE" });
            if (!res.ok) { toast(t("toastDelFail"), false); return; }
            settings = await res.json();
            renderAll();
            toast(t("toastSubDeleted"));
          });
        };
      });
    }

    function filteredNodes() {
      const q = ($("node-search").value || "").trim().toLowerCase();
      const proto = $("flt-proto").value;
      const source = $("flt-source").value;
      const health = $("flt-health").value;
      return (settings.proxyPool || []).filter((p) => {
        if (q && !(p.name + p.host + p.type + (p.clashType || "")).toLowerCase().includes(q)) return false;
        if (proto && (p.clashType || p.type) !== proto && p.type !== proto) return false;
        if (source && p.source !== source) return false;
        if (health && nodeHealth(p) !== health) return false;
        return true;
      });
    }

    function fillProtoFilter() {
      const sel = $("flt-proto");
      const cur = sel.value;
      const types = [...new Set((settings.proxyPool || []).map((p) => p.clashType || p.type).filter(Boolean))].sort();
      sel.innerHTML = '<option value="">' + escapeHtml(t("allProtocols")) + '</option>' +
        types.map((tp) => '<option value="' + escapeAttr(tp) + '">' + escapeHtml(tp) + '</option>').join("");
      if (cur && types.includes(cur)) sel.value = cur;
    }

    function renderNodes() {
      fillProtoFilter();
      const list = filteredNodes();
      const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (nodePage > totalPages) nodePage = totalPages;
      const slice = list.slice((nodePage - 1) * PAGE_SIZE, nodePage * PAGE_SIZE);
      const body = $("nodes-body");
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="9" class="muted" style="padding:16px">' + escapeHtml(t("poolEmpty")) + '</td></tr>';
      } else {
        body.innerHTML = slice.map((p) => {
          const h = nodeHealth(p);
          const route = nodeRoute(p);
          const assigned = assignedWorkers(p.id);
          const rowCls = h === "warn" ? "row-warn" : h === "bad" ? "row-err" : "";
          const zenResult = probeResults[p.id]?.anonymousZen;
          const healthTag = h === "testing"
            ? '<span class="tag blue"><span class="spin"></span>' + escapeHtml(t("testing")) + '</span>'
            : zenResult ? anonymousZenTag(p)
            : h === "healthy" ? anonymousZenTag(p)
            : h === "warn" ? '<span class="tag warn">' + escapeHtml(t("warning")) + '</span>'
            : '<span class="tag err">' + escapeHtml(t("unreachable")) + '</span>';
          const routeTag = '<span class="tag ' + route.cls + '">' + escapeHtml(route.label) + '</span>';
          const aw = assigned.length
            ? assigned.map((a) => escapeHtml(a.id)).join(", ")
            : '<span class="muted">' + escapeHtml(t("unassigned")) + '</span>';
          const enableBridgeBtn = (h === "warn" && p.bridgeable && !bridgeOn())
            ? '<button type="button" class="btn btn-sm btn-enable-bridge">' + escapeHtml(t("enableBridge")) + '</button>'
            : '';
          const testing = testingIds.has(p.id);
          const testBtn = '<button type="button" class="btn btn-sm btn-test-px" data-id="' + escapeAttr(p.id) + '" data-name="' + escapeAttr(p.name) + '"' + (testing || batchTesting ? " disabled" : "") + '>' + escapeHtml(t("testNode")) + '</button>';
          const dotCls = h === "healthy" ? "ok" : h === "warn" ? "warn" : h === "testing" ? "ok" : "err";
          return '<tr class="' + rowCls + '">' +
            '<td><div class="name-cell"><i class="dot ' + dotCls + '"></i>' + escapeHtml(p.name) + '</div></td>' +
            '<td><span class="tag info">' + escapeHtml((p.clashType || p.type || "").toUpperCase()) + '</span></td>' +
            '<td class="mono">' + escapeHtml(p.host + ":" + p.port) + '</td>' +
            '<td>' + escapeHtml(p.source === "subscription" ? t("srcSub") : p.source === "controller" ? t("srcController") : t("srcManual")) + '</td>' +
            '<td>' + routeTag + '</td>' +
            '<td>' + healthTag + '</td>' +
            '<td>' + latencyCell(p) + '</td>' +
            '<td>' + aw + '</td>' +
            '<td style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' + testBtn + enableBridgeBtn +
            '<button type="button" class="btn btn-sm btn-danger btn-del-px" data-id="' + escapeAttr(p.id) + '" data-name="' + escapeAttr(p.name) + '">' + escapeHtml(t("del")) + '</button></td></tr>';
        }).join("");
      }

      body.querySelectorAll(".btn-del-px").forEach((btn) => {
        btn.onclick = () => {
          openConfirm(t("confirmDelProxy"), t("confirmDelProxyBody")(btn.dataset.name), async () => {
            const res = await fetch("/admin/api/proxy-pool/" + encodeURIComponent(btn.dataset.id), { method: "DELETE" });
            if (!res.ok) { toast(t("toastDelFail"), false); return; }
            settings = await res.json();
            delete probeResults[btn.dataset.id];
            renderAll();
            toast(t("toastProxyDeleted"));
          });
        };
      });
      body.querySelectorAll(".btn-enable-bridge").forEach((btn) => {
        btn.onclick = () => {
          $("bridgeEnabled").checked = true;
          showPage("proxy");
          $("bridgeEnabled").focus();
        };
      });
      body.querySelectorAll(".btn-test-px").forEach((btn) => {
        btn.onclick = () => testOneProxy(btn.dataset.id, btn.dataset.name);
      });

      const all = settings.proxyPool || [];
      const healthy = all.filter((p) => nodeHealth(p) === "healthy").length;
      const warn = all.filter((p) => nodeHealth(p) === "warn").length;
      const bad = all.filter((p) => nodeHealth(p) === "bad").length;
      if (lang === "zh") {
        $("nodes-sum").innerHTML =
          all.length + " 节点 · <b class=\\"ok\\">" + healthy + "</b> 健康 · <b class=\\"warn\\">" + warn + "</b> 需桥接 · <b class=\\"err\\">" + bad + "</b> 不可用";
      } else {
        $("nodes-sum").innerHTML =
          all.length + " nodes · <b class=\\"ok\\">" + healthy + "</b> healthy · <b class=\\"warn\\">" + warn + "</b> require bridge · <b class=\\"err\\">" + bad + "</b> unavailable";
      }

      const pager = $("nodes-pager");
      let ph = '';
      ph += '<button type="button" data-p="' + (nodePage - 1) + '" ' + (nodePage <= 1 ? "disabled" : "") + '>&lt;</button>';
      for (let i = 1; i <= totalPages && i <= 7; i++) {
        ph += '<button type="button" data-p="' + i + '" class="' + (i === nodePage ? "active" : "") + '">' + i + '</button>';
      }
      ph += '<button type="button" data-p="' + (nodePage + 1) + '" ' + (nodePage >= totalPages ? "disabled" : "") + '>&gt;</button>';
      pager.innerHTML = ph;
      pager.querySelectorAll("button").forEach((b) => {
        b.onclick = () => {
          const p = Number(b.dataset.p);
          if (p >= 1 && p <= totalPages) { nodePage = p; renderNodes(); }
        };
      });
    }

    function renderActivity() {
      const items = [];
      for (const ev of recentProbeEvents) {
        if (ev.skipped) {
          items.push({
            cls: "warn",
            title: "Proxy test skipped · " + ev.name,
            sub: ev.error || "",
            time: relTime(ev.at),
          });
        } else if (ev.ok) {
          items.push({
            cls: "ok",
            title: "Proxy test succeeded · " + ev.name,
            sub: (ev.latencyMs != null ? ev.latencyMs + "ms" : ""),
            time: relTime(ev.at),
          });
        } else {
          items.push({
            cls: "err",
            title: "Proxy test failed · " + ev.name,
            sub: ev.error || "",
            time: relTime(ev.at),
          });
        }
      }
      if (status?.lastRequestAt) {
        items.push({
          cls: "ok",
          title: (status.lastRequestPath || "/v1/…") + " · " + (status.lastRequestStatus ?? "—"),
          sub: "",
          time: relTime(status.lastRequestAt),
        });
      }
      for (const e of (status?.recentErrors || []).slice(0, 6)) {
        items.push({
          cls: "err",
          title: e.message || "Error",
          sub: e.path || "",
          time: relTime(e.at),
        });
      }
      for (const s of (settings.proxySubscriptions || [])) {
        if (s.lastError) {
          items.push({ cls: "err", title: "Subscription pull failed · " + s.name, sub: s.lastError, time: relTime(s.lastFetchedAt) });
        } else if (s.lastFetchedAt) {
          items.push({ cls: "ok", title: "Subscription · " + s.name, sub: (s.lastImportCount || 0) + " nodes", time: relTime(s.lastFetchedAt) });
        }
      }
      const root = $("activity-list");
      if (!items.length) {
        root.innerHTML = '<li style="grid-template-columns:1fr"><span class="muted">' + escapeHtml(t("noActivity")) + '</span></li>';
        return;
      }
      root.innerHTML = items.slice(0, 8).map((it) =>
        '<li><i class="dot ' + it.cls + '"></i><div><div class="title">' + escapeHtml(it.title) + '</div>' +
        (it.sub ? '<div class="sub">' + escapeHtml(it.sub) + '</div>' : '') +
        '</div><div class="time">' + escapeHtml(it.time) + '</div></li>'
      ).join("");
    }

    function renderUnassigned() {
      const list = (settings.accounts || []).filter((a) => !a.proxyId);
      const box = $("unassigned-box");
      if (!list.length) {
        box.innerHTML = '<div class="empty-dash"><div class="ico">👤</div><strong>' + escapeHtml(t("allAssigned")) + '</strong><div>' + escapeHtml(t("greatJob")) + '</div></div>';
      } else {
        box.innerHTML = '<div class="empty-dash" style="border-color:var(--warn-border)"><strong>' + escapeHtml(t("unassignedCount")(list.length)) + '</strong><div style="margin-top:8px">' +
          list.map((a) => '<div class="mono" style="margin:2px 0">' + escapeHtml(a.id) + '</div>').join("") +
          '</div><button type="button" class="btn btn-sm" id="btn-fix-unassigned" style="margin-top:10px">' + escapeHtml(t("reviewBindings")) + '</button></div>';
        const b = $("btn-fix-unassigned");
        if (b) b.onclick = () => showPage("workers");
      }
    }

    function renderBridge() {
      const b = settings.clashBridge || {};
      $("bridgeEnabled").checked = !!b.enabled;
      $("bridgeApi").value = b.apiBase || "http://127.0.0.1:9090";
      $("bridgeSecret").value = b.apiSecret || "";
      $("bridgeHost").value = b.localProxyHost || "127.0.0.1";
      $("bridgePort").value = b.localProxyPort || 7890;
      $("bridgeGroup").value = b.selectorGroup || "GLOBAL";
      const tag = $("bridge-conn-tag");
      if (!b.enabled) {
        tag.className = "tag";
        tag.textContent = t("disabled");
      } else if (bridgeProbeOk === true) {
        tag.className = "tag ok";
        tag.textContent = t("connected");
      } else if (bridgeProbeOk === false) {
        tag.className = "tag err";
        tag.textContent = t("disconnected");
      } else {
        tag.className = "tag ok";
        tag.textContent = t("enabled");
      }
    }

    function collectBridge() {
      return {
        enabled: $("bridgeEnabled").checked,
        apiBase: $("bridgeApi").value.trim() || "http://127.0.0.1:9090",
        apiSecret: $("bridgeSecret").value,
        localProxyHost: $("bridgeHost").value.trim() || "127.0.0.1",
        localProxyPort: Number($("bridgePort").value) || 7890,
        selectorGroup: $("bridgeGroup").value.trim() || "GLOBAL",
      };
    }

    function proxyOptions(selectedId) {
      const opts = ['<option value="">' + escapeHtml(t("directNoProxy")) + '</option>'];
      for (const p of settings.proxyPool || []) {
        let tag = "";
        if (p.usable) tag = t("tagDirect");
        else if (p.bridgeable) tag = bridgeOn() ? t("tagBridge") : t("tagNeedBridge");
        else tag = t("tagUnusable");
        const bindable = p.enabled && (p.usable || (bridgeOn() && p.bridgeable));
        opts.push('<option value="' + escapeAttr(p.id) + '"' + (p.id === selectedId ? " selected" : "") + (bindable ? "" : " disabled") + ">" +
          escapeHtml(tag + p.name + " · " + p.type + " · " + p.host + ":" + p.port) + "</option>");
      }
      return opts.join("");
    }

    function renderAccounts() {
      const root = $("accounts");
      const list = settings.accounts || [];
      const strategy = $("routing-strategy");
      if (strategy) strategy.value = settings.routingStrategy || "anonymous_first";
      const renderCard = (a, idx) => {
        const kind = a.kind === "authenticated_zen" || (!a.kind && String(a.apiKey || "").trim())
          ? "authenticated_zen"
          : "anonymous_zen";
        const testing = workerTestingIds.has(a.id);
        const testResult = workerTestResults.get(a.id);
        const resultHtml = !testResult ? '' :
          '<div class="worker-test-result ' + (testResult.ok ? 'ok' : 'fail') + '">' +
          escapeHtml(testResult.ok ? t("workerTestOk") : t("workerTestFail")) +
          (testResult.upstreamStatus ? ' · HTTP ' + escapeHtml(String(testResult.upstreamStatus)) : '') +
          (testResult.latencyMs != null ? ' · ' + escapeHtml(String(testResult.latencyMs)) + ' ms' : '') +
          (testResult.proxyName ? ' · ' + escapeHtml(testResult.proxyName) : '') +
          (testResult.egressIp ? ' · ' + escapeHtml(testResult.egressIp) : '') +
          (!testResult.ok && testResult.error?.message ? ' · ' + escapeHtml(testResult.error.message) : '') +
          '</div>';
        const enabled = a.enabled !== false;
        const collapseKey = String(a.id || ("draft-" + (idx + 1)));
        const collapsed = collapsedWorkerIds.has(collapseKey);
        return '<div class="worker-card' + (enabled ? '' : ' disabled-worker') + '" data-idx="' + idx + '" data-worker-key="' + escapeAttr(collapseKey) + '">' +
          '<div class="hd"><span class="worker-title">Worker ' + (idx + 1) + ' · ' + escapeHtml(a.id || t("unassigned")) + (enabled ? '' : ' · ' + escapeHtml(t("disabledState"))) + '</span>' +
          '<div class="worker-actions"><label class="field" style="margin:0;display:flex;align-items:center;gap:6px"><span>' + escapeHtml(t("workerEnabled")) + '</span><span class="toggle"><input class="acc-enabled" type="checkbox"' + (enabled ? ' checked' : '') + ' /><span></span></span></label>' +
          '<button type="button" class="btn btn-sm btn-test-worker" data-idx="' + idx + '"' + (testing ? ' disabled' : '') + '>' + escapeHtml(testing ? t("testingWorker") : t("testWorker")) + '</button>' +
          '<button type="button" class="btn btn-sm btn-danger btn-remove-acc" data-idx="' + idx + '">' + escapeHtml(t("remove")) + '</button>' +
          '<button type="button" class="btn btn-sm collapse-toggle btn-toggle-worker" data-worker-key="' + escapeAttr(collapseKey) + '" aria-expanded="' + String(!collapsed) + '" title="' + escapeAttr(t(collapsed ? "expand" : "collapse")) + '"><span aria-hidden="true">' + (collapsed ? "▾" : "▴") + '</span></button></div></div>' +
          '<div class="worker-body' + (collapsed ? ' is-collapsed' : '') + '">' +
          '<div class="row two"><div><label class="field">' + escapeHtml(t("idLabel")) + '</label>' +
          '<input class="input acc-id" type="text" value="' + escapeAttr(a.id || "") + '" /></div>' +
          '<div><label class="field">' + escapeHtml(t("workerKind")) + '</label>' +
          '<select class="select acc-kind"><option value="anonymous_zen"' + (kind === "anonymous_zen" ? " selected" : "") + '>' + escapeHtml(t("anonymousZen")) + '</option><option value="authenticated_zen"' + (kind === "authenticated_zen" ? " selected" : "") + '>' + escapeHtml(t("authenticatedZen")) + '</option></select></div></div>' +
          '<div class="row"><div><label class="field">' + escapeHtml(t("apiKey")) + '</label>' +
          '<input class="input acc-key" type="password" value="' + escapeAttr(kind === "authenticated_zen" ? (a.apiKey || "") : "") + '" autocomplete="off"' + (kind === "anonymous_zen" ? " disabled" : "") + ' /></div></div>' +
          '<div class="row"><div><label class="field">' + escapeHtml(t("bindProxy")) + '</label>' +
          '<select class="select acc-proxy-id">' + proxyOptions(a.proxyId || "") + '</select></div></div>' + resultHtml + '</div></div>';
      };
      const indexed = list.map((account, idx) => ({ account, idx }));
      const renderColumn = (kind, titleKey, emptyKey) => {
        const items = indexed.filter(({ account }) => {
          const accountKind = account.kind === "authenticated_zen" ||
            (!account.kind && String(account.apiKey || "").trim())
            ? "authenticated_zen"
            : "anonymous_zen";
          return accountKind === kind;
        });
        return '<section class="worker-column" data-worker-kind="' + kind + '">' +
          '<div class="worker-column-hd"><span>' + escapeHtml(t(titleKey)) +
          ' <span class="worker-column-count">' + items.length + '</span></span>' +
          '<button type="button" class="btn btn-sm btn-danger btn-remove-worker-group" data-kind="' + kind + '"' +
          (items.length ? '' : ' disabled') + '>' + escapeHtml(t("removeGroupWorkers")) + '</button></div>' +
          '<div class="worker-column-list">' +
          (items.length ? items.map(({ account, idx }) => renderCard(account, idx)).join("") :
            '<p class="worker-column-empty">' + escapeHtml(t(emptyKey)) + '</p>') +
          '</div></section>';
      };
      root.innerHTML = renderColumn("anonymous_zen", "anonymousWorkers", "noAnonymousWorkers") +
        renderColumn("authenticated_zen", "authenticatedWorkers", "noAuthenticatedWorkers");

      root.querySelectorAll(".btn-remove-acc").forEach((btn) => {
        btn.onclick = () => {
          const card = btn.closest(".worker-card");
          if (card?.dataset.workerKey) collapsedWorkerIds.delete(card.dataset.workerKey);
          persistCollapsedWorkers();
          const drafts = collectAccounts();
          drafts.splice(Number(btn.dataset.idx), 1);
          settings.accounts = drafts;
          renderAccounts();
        };
      });
      root.querySelectorAll(".btn-remove-worker-group").forEach((btn) => {
        btn.onclick = () => {
          const kind = btn.dataset.kind;
          const label = t(kind === "authenticated_zen" ? "authenticatedWorkers" : "anonymousWorkers");
          openConfirm(t("confirmRemoveWorkerGroup")(label), t("confirmRemoveWorkerGroupBody")(label), () => {
            const drafts = collectAccounts();
            settings.accounts = drafts.filter((account) => account.kind !== kind);
            for (const account of drafts) {
              if (account.kind === kind) collapsedWorkerIds.delete(String(account.id));
            }
            persistCollapsedWorkers();
            renderAccounts();
            toast(t("toastWorkerGroupCleared")(label));
          });
        };
      });
      root.querySelectorAll(".btn-toggle-worker").forEach((btn) => {
        btn.onclick = () => {
          const key = btn.dataset.workerKey;
          if (collapsedWorkerIds.has(key)) collapsedWorkerIds.delete(key);
          else collapsedWorkerIds.add(key);
          persistCollapsedWorkers();
          syncWorkerCollapseControls();
        };
      });
      root.querySelectorAll(".acc-kind").forEach((select) => {
        select.onchange = () => {
          const input = select.closest(".worker-card").querySelector(".acc-key");
          input.disabled = select.value === "anonymous_zen";
          if (input.disabled) input.value = "";
          settings.accounts = collectAccounts();
          renderAccounts();
        };
      });
      root.querySelectorAll(".btn-test-worker").forEach((btn) => {
        btn.onclick = async () => {
          const idx = Number(btn.dataset.idx);
          const card = document.querySelector('#accounts .worker-card[data-idx="' + idx + '"]');
          const draft = {
            id: card.querySelector(".acc-id").value.trim() || "account",
            enabled: card.querySelector(".acc-enabled").checked,
            kind: card.querySelector(".acc-kind").value,
            apiKey: card.querySelector(".acc-kind").value === "anonymous_zen" ? "" : card.querySelector(".acc-key").value,
            proxyId: card.querySelector(".acc-proxy-id").value || null,
          };
          const saved = settings.accounts[idx];
          if (!saved || draft.id !== saved.id || draft.enabled !== (saved.enabled !== false) || draft.kind !== saved.kind || draft.apiKey !== saved.apiKey || draft.proxyId !== (saved.proxyId || null)) {
            toast(t("saveBeforeWorkerTest"), false);
            return;
          }
          settings.accounts = collectAccounts();
          workerTestingIds.add(saved.id);
          workerTestResults.delete(saved.id);
          renderAccounts();
          try {
            const res = await fetch("/admin/api/workers/" + encodeURIComponent(saved.id) + "/test", { method: "POST" });
            const data = await res.json();
            workerTestResults.set(saved.id, data);
            if (data.egressIp && saved.proxyId && probeResults[saved.proxyId]) {
              probeResults[saved.proxyId].egressIp = data.egressIp;
            }
            toast(data.ok ? t("workerTestOk") : t("workerTestFail"), !!data.ok);
          } catch (e) {
            workerTestResults.set(saved.id, { ok: false, error: { message: String(e.message || e) } });
            toast(t("workerTestFail"), false);
          } finally {
            workerTestingIds.delete(saved.id);
            renderAccounts();
          }
        };
      });
      syncWorkerCollapseControls();
    }

    function syncWorkerCollapseControls() {
      const cards = Array.from(document.querySelectorAll("#accounts .worker-card"));
      for (const card of cards) {
        const key = card.dataset.workerKey;
        const collapsed = collapsedWorkerIds.has(key);
        card.classList.toggle("is-collapsed-card", collapsed);
        card.querySelector(".worker-body")?.classList.toggle("is-collapsed", collapsed);
        const btn = card.querySelector(".btn-toggle-worker");
        if (btn) {
          btn.setAttribute("aria-expanded", String(!collapsed));
          btn.title = t(collapsed ? "expand" : "collapse");
          const icon = btn.querySelector("span");
          if (icon) icon.textContent = collapsed ? "▾" : "▴";
        }
      }
      const allCollapsed = cards.length > 0 && cards.every((card) => collapsedWorkerIds.has(card.dataset.workerKey));
      document.querySelectorAll("#accounts .worker-column-list").forEach((list) => {
        list.classList.toggle("worker-list-scroll", list.querySelectorAll(".worker-card").length > 4);
      });
      const toggleAll = $("btn-toggle-all-workers");
      if (toggleAll) {
        toggleAll.disabled = cards.length === 0;
        toggleAll.textContent = t(allCollapsed ? "expandAll" : "collapseAll");
        toggleAll.dataset.action = allCollapsed ? "expand" : "collapse";
      }
      const removeAll = $("btn-remove-all-workers");
      if (removeAll) removeAll.disabled = cards.length === 0;
    }

    function collectAccounts() {
      return Array.from(document.querySelectorAll("#accounts .worker-card"))
        .sort((a, b) => Number(a.dataset.idx) - Number(b.dataset.idx))
        .map((el) => ({
          id: el.querySelector(".acc-id").value.trim() || "account",
          enabled: el.querySelector(".acc-enabled").checked,
          kind: el.querySelector(".acc-kind").value,
          apiKey: el.querySelector(".acc-kind").value === "anonymous_zen" ? "" : el.querySelector(".acc-key").value,
          proxyId: el.querySelector(".acc-proxy-id").value || null,
          proxy: null,
        }));
    }

    function fillGateway() {
      $("baseUrl").value = settings.baseUrl || "";
      $("relayAccessToken").value = settings.relayAccessToken || "";
      $("port").value = settings.port || 9876;
      $("cliUserAgent").value = settings.cliUserAgent || "";
      $("cliClient").value = settings.cliClient || "";
      $("cliProject").value = settings.cliProject || "";
      $("synthesizeCliHeaders").checked = !!settings.synthesizeCliHeaders;
    }

    function fmtNum(n) {
      const v = Number(n) || 0;
      return v.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
    }

    function fmtRate(rate) {
      if (rate == null || !Number.isFinite(Number(rate))) return "—";
      return (Number(rate) * 100).toFixed(1) + "%";
    }

    function renderWorkerStats() {
      const body = $("ov-worker-stats");
      const attemptsBody = $("ov-attempts");
      const totalsEl = $("ov-usage-totals");
      if (!body) return;
      const workers = status?.workers || [];
      const totals = status?.usageTotals || {};
      const byKind = status?.usageTotalsByKind || {};
      if (totalsEl) {
        totalsEl.textContent =
          t("totalsLabel") + ": " +
          fmtNum(totals.requestCount) + " " + t("attemptCount") + " · " +
          fmtNum(totals.totalTokens) + " tok · " +
          t("anonymousZen") + " " + fmtNum(byKind.anonymous_zen?.requestCount) + " req · " +
          t("authenticatedZen") + " " + fmtNum(byKind.authenticated_zen?.requestCount) + " req";
      }
      if (!workers.length) {
        body.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px">' + escapeHtml(t("noWorkers")) + '</td></tr>';
      } else {
        body.innerHTML = workers.map((w) => {
          const kindLabel = t(w.kind === "authenticated_zen" ? "authenticatedZen" : "anonymousZen");
          const routeName = w.proxyName || (w.proxyId ? w.proxyId : t("directEgress"));
          const egress = w.egressIp || t("unknownEgress");
          const stateLabel = !w.enabled ? t("disabledState") : w.ready ? t("readyState") : t("coolingState");
          const statusText = w.lastStatus == null
            ? (w.lastRequestAt ? t("outcomeTransportError") : "—")
            : "HTTP " + w.lastStatus;
          return '<tr>' +
            '<td><strong>' + escapeHtml(w.accountId) + '</strong><div style="margin-top:4px"><span class="tag ' + (w.kind === "anonymous_zen" ? "blue" : "info") + '">' + escapeHtml(kindLabel) + '</span></div><div class="muted mono" style="margin-top:4px">' + escapeHtml(w.credentialLabel || "—") + '</div></td>' +
            '<td><strong>' + escapeHtml(routeName) + '</strong><div class="muted mono">' + escapeHtml(egress) + '</div></td>' +
            '<td class="mono"><strong>' + fmtNum(w.requestCount) + '</strong><div class="muted">Chat ' + fmtNum(w.chatCount) + ' · ' + escapeHtml(t("modelsUsed")) + ' ' + fmtNum(w.distinctModelCount) + '</div>' +
              (Object.keys(w.modelUsage || {}).length ? '<div class="muted" style="margin-top:4px">' + Object.entries(w.modelUsage).sort((a, b) => Number(b[1]) - Number(a[1])).map(([model, count]) => escapeHtml(model) + ' ×' + fmtNum(count)).join(' · ') + '</div>' : '') +
              (w.modelsCount ? '<div class="muted">' + escapeHtml(t("modelsEndpoint")) + ' ' + fmtNum(w.modelsCount) + '</div>' : '') + '</td>' +
            '<td><span class="ok mono">' + fmtNum(w.successCount) + '</span> / <span class="err mono">' + fmtNum(w.errorCount) + '</span><div class="muted">' + escapeHtml(statusText) + '</div></td>' +
            '<td class="mono"><strong>' + fmtNum(w.totalTokens) + '</strong><div class="muted">in ' + fmtNum(w.promptTokens) + ' · out ' + fmtNum(w.completionTokens) + '</div></td>' +
            '<td class="mono">' + escapeHtml(fmtRate(w.cacheRate)) + '<div class="muted">read ' + fmtNum(w.cacheReadTokens) + ' · write ' + fmtNum(w.cacheWriteTokens) + '</div></td>' +
            '<td><span class="tag ' + (!w.enabled ? "" : w.ready ? "ok" : "warn") + '">' + escapeHtml(stateLabel) + '</span>' + (w.enabled && !w.ready && w.cooldownUntil ? '<div class="muted">' + escapeHtml(relTime(new Date(w.cooldownUntil).toISOString())) + '</div>' : '') + '</td>' +
            '<td class="muted">' + escapeHtml(w.lastRequestAt ? relTime(w.lastRequestAt) : "—") + '</td>' +
            '</tr>';
        }).join("");
      }

      const attempts = status?.recentAttempts || [];
      if (!attemptsBody) return;
      if (!attempts.length) {
        attemptsBody.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px">' + escapeHtml(t("noAttempts")) + '</td></tr>';
        return;
      }
      const outcomeText = {
        success: "outcomeSuccess",
        rate_limited: "outcomeRateLimit",
        auth_failed: "outcomeAuthFailed",
        upstream_error: "outcomeUpstreamError",
        transport_error: "outcomeTransportError",
      };
      attemptsBody.innerHTML = attempts.map((a) => {
        const ok = a.outcome === "success";
        const warn = a.outcome === "rate_limited" || a.outcome === "upstream_error";
        const resultClass = ok ? "ok" : warn ? "warn" : "err";
        const resultLabel = t(outcomeText[a.outcome] || "outcomeUpstreamError");
        const kindLabel = t(a.accountKind === "authenticated_zen" ? "authenticatedZen" : "anonymousZen");
        const route = a.proxyName || a.clashNodeName || a.proxyId || t("directEgress");
        const egress = a.egressIp || t("unknownEgress");
        const statusLabel = a.status == null ? resultLabel : "HTTP " + a.status + " · " + resultLabel;
        return '<tr class="' + (ok ? "" : warn ? "row-warn" : "row-err") + '">' +
          '<td class="muted">' + escapeHtml(relTime(a.at)) + '</td>' +
          '<td><span class="mono">' + escapeHtml(String(a.requestId || "").slice(0, 8)) + '</span><div class="muted">' + escapeHtml(a.attempt + "/" + a.maxAttempts) + '</div></td>' +
          '<td><strong>' + escapeHtml(a.operation) + '</strong><div class="muted mono">' + escapeHtml(a.model || "—") + '</div></td>' +
          '<td><strong>' + escapeHtml(a.accountId) + '</strong><div><span class="tag ' + (a.accountKind === "anonymous_zen" ? "blue" : "info") + '">' + escapeHtml(kindLabel) + '</span></div><div class="muted mono">' + escapeHtml(a.credentialLabel || (a.accountKind === "anonymous_zen" ? "public" : "—")) + '</div></td>' +
          '<td><strong>' + escapeHtml(route) + '</strong><div class="muted mono">' + escapeHtml(egress) + '</div></td>' +
          '<td><span class="tag ' + resultClass + '">' + escapeHtml(statusLabel) + '</span>' + (a.error ? '<div class="attempt-error" title="' + escapeAttr(a.error) + '">' + escapeHtml(a.error) + '</div>' : '') + '</td>' +
          '<td class="mono">' + fmtNum(a.latencyMs) + ' ms</td>' +
          '<td><span class="tag ' + (a.willRetry ? "warn" : ok ? "ok" : "err") + '">' + escapeHtml(a.willRetry ? t("retrying") : ok ? t("returned") : t("noRetry")) + '</span></td>' +
          '</tr>';
      }).join("");
    }

    function renderStatusChrome() {
      const running = !!(status && status.running);
      const pill = $("run-pill");
      pill.className = "run-pill" + (running ? "" : " down");
      $("run-label").textContent = running ? t("running") : t("stopped");
      $("addr-box").textContent = location.origin;
      $("usage-base").textContent = location.origin + "/v1";

      renderWorkerStats();

      // overview errors
      const errs = status?.recentErrors || [];
      $("ov-errors").innerHTML = errs.length
        ? errs.map((e) => '<li><i class="dot err"></i><div><div class="title">' + escapeHtml(e.message) + '</div><div class="sub mono">' + escapeHtml(e.path || "") + '</div></div><div class="time">' + escapeHtml(relTime(e.at)) + '</div></li>').join("")
        : '<li style="grid-template-columns:1fr"><span class="muted">' + escapeHtml(t("none")) + '</span></li>';
    }

    function renderAll() {
      fillGateway();
      renderBridge();
      renderMetrics("pp-metrics");
      renderMetrics("ov-metrics");
      renderIsolation();
      renderSubs();
      renderNodes();
      renderActivity();
      renderUnassigned();
      renderAccounts();
      renderStatusChrome();
    }

    function openConfirm(title, body, cb) {
      $("confirm-title").textContent = title;
      $("confirm-body").textContent = body;
      confirmCb = cb;
      $("confirm-float").classList.add("show");
    }
    function closeConfirm() {
      $("confirm-float").classList.remove("show");
      confirmCb = null;
    }
    $("confirm-cancel").onclick = closeConfirm;
    $("confirm-x").onclick = closeConfirm;
    $("confirm-ok").onclick = async () => {
      const cb = confirmCb;
      closeConfirm();
      if (cb) await cb();
    };

    function openModal(id) { $(id).classList.add("show"); }
    function closeModal(id) { $(id).classList.remove("show"); }
    $("btn-add-proxy-open").onclick = () => openModal("modal-proxy");
    $("btn-add-sub-open").onclick = () => openModal("modal-sub");
    $("modal-proxy-cancel").onclick = () => closeModal("modal-proxy");
    $("modal-sub-cancel").onclick = () => closeModal("modal-sub");
    $("modal-proxy").addEventListener("click", (e) => { if (e.target.id === "modal-proxy") closeModal("modal-proxy"); });
    $("modal-sub").addEventListener("click", (e) => { if (e.target.id === "modal-sub") closeModal("modal-sub"); });

    $("btn-more").onclick = (e) => {
      e.stopPropagation();
      $("more-menu").classList.toggle("show");
    };
    document.addEventListener("click", () => $("more-menu").classList.remove("show"));
    $("menu-refresh").onclick = () => refreshAll();
    $("menu-goto-workers").onclick = () => showPage("workers");

    $("btn-toggle-secret").onclick = () => {
      const el = $("bridgeSecret");
      el.type = el.type === "password" ? "text" : "password";
    };

    document.querySelectorAll(".nav-item").forEach((el) => {
      el.onclick = () => showPage(el.dataset.page);
    });
    $("lang-en").onclick = () => setLang("en");
    $("lang-zh").onclick = () => setLang("zh");
    $("btn-theme").onclick = toggleTheme;
    $("btn-toggle-all-workers").onclick = () => {
      const cards = Array.from(document.querySelectorAll("#accounts .worker-card"));
      const collapse = $("btn-toggle-all-workers").dataset.action !== "expand";
      for (const card of cards) {
        if (collapse) collapsedWorkerIds.add(card.dataset.workerKey);
        else collapsedWorkerIds.delete(card.dataset.workerKey);
      }
      persistCollapsedWorkers();
      syncWorkerCollapseControls();
    };

    ["node-search", "flt-proto", "flt-source", "flt-health"].forEach((id) => {
      $(id).addEventListener("input", () => { nodePage = 1; renderNodes(); });
      $(id).addEventListener("change", () => { nodePage = 1; renderNodes(); });
    });

    async function loadSettings() {
      const res = await fetch("/admin/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error("settings " + res.status);
      settings = await res.json();
      serverAccountIds = new Set((settings.accounts || []).map((account) => account.id));
      if (!settings.proxyPool) settings.proxyPool = [];
      if (!settings.proxySubscriptions) settings.proxySubscriptions = [];
      if (!settings.clashBridge) {
        settings.clashBridge = {
          enabled: false, apiBase: "http://127.0.0.1:9090", apiSecret: "",
          localProxyHost: "127.0.0.1", localProxyPort: 7890, selectorGroup: "GLOBAL",
        };
      }
    }

    async function loadStatus() {
      const res = await fetch("/admin/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error("status " + res.status);
      status = await res.json();
    }

    async function loadProbes() {
      const res = await fetch("/admin/api/proxy-pool", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.probeResults && typeof data.probeResults === "object") {
        probeResults = data.probeResults;
      }
      if (data.batchProbe) batchProgress = data.batchProbe;
    }

    async function refreshAll() {
      if (settings && document.querySelector("#accounts .worker-card")) {
        await reloadAfterBatchPreservingDrafts();
      } else {
        await Promise.all([loadSettings(), loadStatus(), loadProbes()]);
      }
      renderAll();
      syncBatchProgress(batchProgress);
      toast(t("toastRefreshed"));
    }

    function updateBatchProgress(progress) {
      if (!progress) return;
      const completedIds = new Set(progress.completedIds || []);
      for (const id of completedIds) testingIds.delete(id);
      const btn = $("btn-batch-test");
      if (btn) {
        btn.disabled = !!progress.running || batchTesting;
        btn.textContent = progress.running
          ? (progress.stage === "screening"
              ? t("batchScreening")(progress.stageCompleted || 0, progress.stageTotal || progress.total || 0)
              : t("batchProgress")(progress.completed || 0, progress.total || 0))
          : t("batchTest");
      }
      ["btn-save-accounts", "btn-save-gateway", "btn-assign-proxies"].forEach((id) => {
        const action = $(id);
        if (action) action.disabled = !!progress.running;
      });
      renderNodes();
    }

    function stopBatchProgressPolling() {
      if (batchProgressTimer) clearTimeout(batchProgressTimer);
      batchProgressTimer = null;
    }

    function scheduleBatchProgressPoll(delay = 750) {
      stopBatchProgressPolling();
      batchProgressTimer = setTimeout(async () => {
        batchProgressTimer = null;
        await pollBatchProgress();
        if (batchTesting) scheduleBatchProgressPoll();
      }, delay);
    }

    function syncBatchProgress(progress) {
      if (!progress) return;
      batchProgress = progress;
      if (progress.running) {
        if (!batchTesting) batchBaselineAccountIds = new Set(serverAccountIds);
        batchTesting = true;
        batchProgressSeenRunning = true;
        for (const proxy of settings?.proxyPool || []) testingIds.add(proxy.id);
        scheduleBatchProgressPoll();
      }
      updateBatchProgress(progress);
    }

    async function reloadAfterBatchPreservingDrafts(includeProbes = true) {
      const drafts = settings ? collectAccounts() : [];
      const baseline = new Set(batchBaselineAccountIds);
      const loaders = [loadSettings(), loadStatus()];
      if (includeProbes) loaders.push(loadProbes());
      await Promise.all(loaders);
      const draftIds = new Set(drafts.map((account) => account.id));
      const draftAnonymousProxyIds = new Set(drafts
        .filter((account) => account.kind === "anonymous_zen" && account.proxyId)
        .map((account) => account.proxyId));
      const draftAnonymousEgressIps = new Set(drafts
        .filter((account) => account.kind === "anonymous_zen" && account.proxyId)
        .map((account) => probeResults[account.proxyId]?.egressIp)
        .filter(Boolean));
      const autoAdded = (settings.accounts || []).filter((account) =>
        !baseline.has(account.id) && !draftIds.has(account.id) &&
        !(account.kind === "anonymous_zen" && account.proxyId && (
          draftAnonymousProxyIds.has(account.proxyId) ||
          (probeResults[account.proxyId]?.egressIp &&
            draftAnonymousEgressIps.has(probeResults[account.proxyId].egressIp))
        ))
      );
      settings.accounts = [...drafts, ...autoAdded];
      for (const account of autoAdded) batchBaselineAccountIds.add(account.id);
    }

    function renderBatchDerivedViews() {
      const active = document.activeElement?.closest?.(".worker-card");
      const activeField = document.activeElement;
      const focusState = active && activeField ? {
        workerKey: active.dataset.workerKey,
        fieldClass: ["acc-id", "acc-key", "acc-proxy-id", "acc-kind", "acc-enabled"]
          .find((name) => activeField.classList.contains(name)),
        start: activeField.selectionStart,
        end: activeField.selectionEnd,
      } : null;
      renderMetrics("pp-metrics");
      renderMetrics("ov-metrics");
      renderIsolation();
      renderUnassigned();
      renderAccounts();
      renderStatusChrome();
      if (focusState?.fieldClass) {
        const card = Array.from(document.querySelectorAll("#accounts .worker-card"))
          .find((item) => item.dataset.workerKey === focusState.workerKey);
        const field = card?.querySelector("." + focusState.fieldClass);
        field?.focus();
        if (typeof field?.setSelectionRange === "function" && focusState.start != null) {
          field.setSelectionRange(focusState.start, focusState.end ?? focusState.start);
        }
      }
    }

    async function pollBatchProgress() {
      try {
        const res = await fetch("/admin/api/proxy-pool", { cache: "no-store" });
        if (!res.ok) return;
        const poolState = await res.json();
        const progress = poolState.batchProbe;
        if (poolState.probeResults) probeResults = poolState.probeResults;
        if (settings) renderIsolation();
        batchProgress = progress;
        if (progress?.running) batchProgressSeenRunning = true;
        updateBatchProgress(progress);
        const addedWorkerCount = progress?.addedWorkerIds?.length || 0;
        if (progress?.running && addedWorkerCount > lastBatchRenderedWorkerCount) {
          await reloadAfterBatchPreservingDrafts(false);
          lastBatchRenderedWorkerCount = addedWorkerCount;
          renderBatchDerivedViews();
        }
        if (progress && !progress.running && batchTesting && batchProgressSeenRunning && !batchRequestActive) {
          batchTesting = false;
          testingIds.clear();
          stopBatchProgressPolling();
          await reloadAfterBatchPreservingDrafts();
          renderAll();
          updateBatchProgress(batchProgress);
        }
      } catch {
        // The original POST remains authoritative; the next poll retries.
      }
    }

    async function testOneProxy(id, name) {
      if (!id || testingIds.has(id) || batchTesting) return;
      testingIds.add(id);
      renderNodes();
      try {
        const res = await fetch("/admin/api/proxy-pool/" + encodeURIComponent(id) + "/test", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
        if (data.progress) batchProgress = data.progress;
        if (data.probeResults) probeResults = data.probeResults;
        if (data.settings) settings = data.settings;
        else if (data.result) probeResults[id] = data.result;
        const result = data.result || probeResults[id];
        if (result) pushProbeEvent(result, name || result.id);
        if (result?.ok) toast(t("toastTestOk")(name || id, result.latencyMs ?? "—"));
        else toast(t("toastTestFail")(name || id, result?.error || ""), false);
      } catch (e) {
        toast(String(e.message || e), false);
      } finally {
        testingIds.delete(id);
        renderNodes();
        renderActivity();
      }
    }

    async function batchTestProxies() {
      if (batchTesting) return;
      const pool = settings.proxyPool || [];
      if (!pool.length) { toast(t("poolEmpty"), false); return; }
      batchTesting = true;
      batchRequestActive = true;
      batchProgressSeenRunning = false;
      lastBatchRenderedWorkerCount = 0;
      batchBaselineAccountIds = new Set(serverAccountIds);
      for (const p of pool) testingIds.add(p.id);
      const btn = $("btn-batch-test");
      if (btn) btn.disabled = true;
      renderNodes();
      toast(t("toastTesting"));
      const request = fetch("/admin/api/proxy-pool/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      scheduleBatchProgressPoll(200);
      try {
        const res = await request;
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
        if (data.progress) batchProgress = data.progress;
        if (data.probeResults) probeResults = data.probeResults;
        const byId = {};
        for (const p of pool) byId[p.id] = p.name;
        for (const r of data.results || []) pushProbeEvent(r, byId[r.id] || r.id);
        const s = data.summary || { ok: 0, fail: 0, skip: 0 };
        const added = data.autoWorkers?.added || 0;
        await reloadAfterBatchPreservingDrafts();
        renderAll();
        toast(t("toastBatchDone")(s.ok || 0, s.fail || 0, s.skip || 0) + (added ? " · " + t("toastBatchWorkers")(added) : ""), (s.fail || 0) === 0);
      } catch (e) {
        toast(String(e.message || e), false);
      } finally {
        batchRequestActive = false;
        stopBatchProgressPolling();
        testingIds.clear();
        batchTesting = false;
        batchProgressSeenRunning = false;
        if (btn) { btn.disabled = false; btn.textContent = t("batchTest"); }
        renderNodes();
        renderActivity();
      }
    }

    $("btn-top-refresh").onclick = () => refreshAll();
    $("btn-nodes-refresh").onclick = () => refreshAll();
    $("btn-batch-test").onclick = () => batchTestProxies();
    $("btn-reset-stats").onclick = async () => {
      if (!confirm(t("confirmResetStats"))) return;
      const res = await fetch("/admin/api/worker-stats/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) { toast(t("toastSaveFail"), false); return; }
      await loadStatus();
      renderStatusChrome();
      toast(t("toastStatsReset"));
    };

    $("btn-save-bridge").onclick = async () => {
      const body = { ...settings, clashBridge: collectBridge(), accounts: collectAccounts() };
      const res = await fetch("/admin/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { toast(t("toastSaveFail"), false); return; }
      settings = await res.json();
      renderAll();
      toast(t("toastBridgeSaved"));
    };

    $("btn-probe-bridge").onclick = async () => {
      const msg = $("bridge-probe-msg");
      msg.className = "probe-ok show";
      msg.textContent = t("toastProbing");
      const res = await fetch("/admin/api/clash-bridge/probe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectBridge()),
      });
      const data = await res.json();
      bridgeProbeOk = !!data.ok;
      msg.className = "probe-ok show" + (data.ok ? "" : " fail");
      msg.textContent = (data.ok ? "✓ " : "! ") + (data.message || "") + (data.groups ? " · " + data.groups.slice(0, 6).join(", ") : "");
      renderBridge();
      toast(data.ok ? t("toastClashOk") : t("toastClashFail"), data.ok);
    };

    $("btn-import-clash").onclick = async () => {
      const btn = $("btn-import-clash");
      btn.disabled = true;
      try {
        const bridge = collectBridge();
        const res = await fetch("/admin/api/clash-bridge/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bridge),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
        settings = data.settings;
        bridgeProbeOk = true;
        await loadStatus();
        renderAll();
        toast(t("toastControllerImported")(data.imported || 0, data.group || bridge.selectorGroup), (data.imported || 0) > 0);
      } catch (e) {
        toast(String(e.message || e), false);
      } finally {
        btn.disabled = false;
      }
    };

    $("btn-save-gateway").onclick = async () => {
      const body = {
        ...settings,
        routingStrategy: $("routing-strategy")?.value || settings.routingStrategy || "anonymous_first",
        baseUrl: $("baseUrl").value.trim(),
        relayAccessToken: $("relayAccessToken").value.trim(),
        port: Number($("port").value) || 9876,
        synthesizeCliHeaders: $("synthesizeCliHeaders").checked,
        cliUserAgent: $("cliUserAgent").value.trim(),
        cliClient: $("cliClient").value.trim(),
        cliProject: $("cliProject").value.trim(),
        clashBridge: collectBridge(),
        accounts: collectAccounts(),
      };
      const res = await fetch("/admin/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { toast(t("toastSaveFail"), false); return; }
      settings = await res.json();
      await loadStatus();
      renderAll();
      toast(t("toastGatewaySaved"));
    };

    $("btn-save-accounts").onclick = async () => {
      const body = { ...settings, routingStrategy: $("routing-strategy").value, accounts: collectAccounts() };
      const res = await fetch("/admin/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { toast(t("toastSaveFail"), false); return; }
      settings = await res.json();
      await loadStatus();
      renderAll();
      toast(t("toastWorkersSaved"));
    };

    $("btn-assign-proxies").onclick = async () => {
      const btn = $("btn-assign-proxies");
      btn.disabled = true;
      try {
        // Prefer current form state so unsaved workers still get bindings
        const res = await fetch("/admin/api/workers/assign-proxies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accounts: collectAccounts() }),
        });
        const data = await res.json();
        if (!res.ok) {
          const msg =
            data.error?.message && String(data.error.message).includes("No healthy")
              ? t("toastAssignNoHealthy")
              : (data.error?.message || t("toastAssignFail"));
          toast(msg, false);
          return;
        }
        settings = data.settings || settings;
        await loadStatus();
        renderAll();
        toast(t("toastAssignProxies")(data.assigned || 0, (settings.accounts || []).length, data.healthyAvailable || 0));
      } catch {
        toast(t("toastAssignFail"), false);
      } finally {
        btn.disabled = false;
      }
    };

    $("btn-add-account").onclick = () => {
      settings.accounts = collectAccounts();
      settings.accounts.push({
        id: "worker-" + (settings.accounts.length + 1),
        kind: "anonymous_zen", enabled: true, apiKey: "", proxyId: null, proxy: null,
      });
      renderAccounts();
    };

    $("btn-remove-all-workers").onclick = () => {
      if (document.querySelectorAll("#accounts .worker-card").length === 0) return;
      openConfirm(t("confirmRemoveAllWorkers"), t("confirmRemoveAllWorkersBody"), () => {
        settings.accounts = [];
        collapsedWorkerIds.clear();
        persistCollapsedWorkers();
        renderAccounts();
        toast(t("toastWorkersCleared"));
      });
    };

    $("btn-add-proxy").onclick = async () => {
      const host = $("pxHost").value.trim();
      const port = Number($("pxPort").value);
      if (!host || !port) { toast(t("toastHostPort"), false); return; }
      const res = await fetch("/admin/api/proxy-pool", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("pxName").value.trim() || undefined,
          type: $("pxType").value, host, port,
          username: $("pxUser").value || undefined,
          password: $("pxPass").value || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error?.message || t("toastAddFail"), false); return; }
      settings = data;
      ["pxHost","pxPort","pxName","pxUser","pxPass"].forEach((id) => { $(id).value = ""; });
      closeModal("modal-proxy");
      renderAll();
      toast(t("toastAddedPool"));
    };

    $("btn-add-sub").onclick = async () => {
      const url = $("subUrl").value.trim();
      if (!url) { toast(t("toastSubUrlReq"), false); return; }
      const res = await fetch("/admin/api/proxy-subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: $("subName").value.trim() || undefined, url }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error?.message || t("toastAddFail"), false); return; }
      settings = data.settings;
      $("subUrl").value = "";
      $("subName").value = "";
      closeModal("modal-sub");
      renderAll();
      toast(t("toastSubAdded"));
    };

    $("btn-fetch-all").onclick = async () => {
      const btn = $("btn-fetch-all");
      btn.disabled = true;
      try {
        const res = await fetch("/admin/api/proxy-subscriptions/fetch-all", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
        settings = data.settings;
        renderAll();
        const ok = (data.results || []).filter((r) => r.ok).length;
        toast(t("toastFetchDone")(ok, (data.results || []).length));
      } catch (e) {
        toast(String(e.message || e), false);
      } finally { btn.disabled = false; }
    };

    initSectionCollapsibles();
    applyStaticI18n();
    showPage(page);
    $("run-label").textContent = t("loading");
    Promise.all([loadSettings(), loadStatus(), loadProbes()]).then(() => {
      renderAll();
      syncBatchProgress(batchProgress);
    }).catch((e) => toast(String(e), false));
  </script>
</body>
</html>
`;
