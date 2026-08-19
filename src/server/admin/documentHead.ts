/** Document shell, theme bootstrap, and foundational admin styles. */
export const ADMIN_DOCUMENT_HEAD = `<!DOCTYPE html>
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

`;
