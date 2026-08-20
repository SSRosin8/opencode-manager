/** Document shell, theme bootstrap, and foundational admin styles. */
export const ADMIN_DOCUMENT_HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>opencode-manager - Admin</title>
  <script>
    try {
      const storedTheme = localStorage.getItem("opencode-manager-theme");
      const savedTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
      const preferredTheme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      document.documentElement.dataset.theme = savedTheme || preferredTheme;
      const storedAccent = localStorage.getItem("opencode-manager-accent");
      if (storedAccent) document.documentElement.dataset.accent = storedAccent;
    } catch { document.documentElement.dataset.theme = "dark"; }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #06090f;
      --bg-elevated: #0a0f18;
      --sidebar: #070b12;
      --panel: rgba(17, 24, 39, 0.72);
      --panel-solid: #111827;
      --panel-2: rgba(20, 28, 42, 0.65);
      --border: rgba(255, 255, 255, 0.06);
      --border-hi: rgba(255, 255, 255, 0.12);
      --text: #f0f4fc;
      --text-2: #94a3b8;
      --muted: #64748b;
      --faint: #334155;
      --accent: #3b82f6;
      --accent-hi: #60a5fa;
      --accent-dim: rgba(59, 130, 246, 0.12);
      --accent-border: rgba(59, 130, 246, 0.4);
      --accent-glow: rgba(59, 130, 246, 0.15);
      --ok: #22c55e;
      --ok-dim: rgba(34, 197, 94, 0.1);
      --ok-border: rgba(34, 197, 94, 0.3);
      --warn: #f59e0b;
      --warn-dim: rgba(245, 158, 11, 0.1);
      --warn-border: rgba(245, 158, 11, 0.35);
      --err: #ef4444;
      --err-dim: rgba(239, 68, 68, 0.1);
      --err-border: rgba(239, 68, 68, 0.35);
      --radius: 12px;
      --radius-sm: 8px;
      --topbar-h: 54px;
      --sidebar-w: 200px;
      --font: "Inter", system-ui, -apple-system, sans-serif;
      --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
      --shadow: 0 8px 32px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.2);
      --glass-blur: 16px;
      --glass-bg: rgba(15, 23, 42, 0.65);
      --glass-border: rgba(255, 255, 255, 0.08);
      color-scheme: dark;
    }
    /* Accent: purple-blue */
    :root[data-accent="violet"] {
      --accent: #7c3aed;
      --accent-hi: #a78bfa;
      --accent-dim: rgba(124, 58, 237, 0.12);
      --accent-border: rgba(124, 58, 237, 0.4);
      --accent-glow: rgba(124, 58, 237, 0.15);
    }
    /* Accent: green/hacker */
    :root[data-accent="green"] {
      --accent: #10b981;
      --accent-hi: #34d399;
      --accent-dim: rgba(16, 185, 129, 0.12);
      --accent-border: rgba(16, 185, 129, 0.4);
      --accent-glow: rgba(16, 185, 129, 0.15);
    }
    /* Accent: warm orange */
    :root[data-accent="amber"] {
      --accent: #f59e0b;
      --accent-hi: #fbbf24;
      --accent-dim: rgba(245, 158, 11, 0.12);
      --accent-border: rgba(245, 158, 11, 0.4);
      --accent-glow: rgba(245, 158, 11, 0.15);
    }
    :root[data-theme="light"] {
      --bg: #f8fafc;
      --bg-elevated: #ffffff;
      --sidebar: #ffffff;
      --panel: rgba(255, 255, 255, 0.78);
      --panel-solid: #ffffff;
      --panel-2: rgba(241, 245, 249, 0.7);
      --border: rgba(15, 23, 42, 0.08);
      --border-hi: rgba(15, 23, 42, 0.15);
      --text: #0f172a;
      --text-2: #475569;
      --muted: #64748b;
      --faint: #cbd5e1;
      --accent: #2563eb;
      --accent-hi: #1d4ed8;
      --accent-dim: rgba(37, 99, 235, 0.08);
      --accent-border: rgba(37, 99, 235, 0.3);
      --accent-glow: rgba(37, 99, 235, 0.1);
      --ok: #16a34a;
      --ok-dim: rgba(22, 163, 74, 0.07);
      --ok-border: rgba(22, 163, 74, 0.25);
      --warn: #d97706;
      --warn-dim: rgba(217, 119, 6, 0.07);
      --warn-border: rgba(217, 119, 6, 0.25);
      --err: #dc2626;
      --err-dim: rgba(220, 38, 38, 0.06);
      --err-border: rgba(220, 38, 38, 0.25);
      --shadow: 0 8px 32px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04);
      --glass-blur: 12px;
      --glass-bg: rgba(255, 255, 255, 0.7);
      --glass-border: rgba(15, 23, 42, 0.06);
      color-scheme: light;
    }
    :root[data-theme="light"][data-accent="violet"] {
      --accent: #7c3aed; --accent-hi: #6d28d9;
      --accent-dim: rgba(124, 58, 237, 0.08); --accent-border: rgba(124, 58, 237, 0.3);
      --accent-glow: rgba(124, 58, 237, 0.1);
    }
    :root[data-theme="light"][data-accent="green"] {
      --accent: #059669; --accent-hi: #047857;
      --accent-dim: rgba(5, 150, 105, 0.08); --accent-border: rgba(5, 150, 105, 0.3);
      --accent-glow: rgba(5, 150, 105, 0.1);
    }
    :root[data-theme="light"][data-accent="amber"] {
      --accent: #d97706; --accent-hi: #b45309;
      --accent-dim: rgba(217, 119, 6, 0.08); --accent-border: rgba(217, 119, 6, 0.3);
      --accent-glow: rgba(217, 119, 6, 0.1);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--font);
      font-size: 13px;
      color: var(--text);
      background: var(--bg);
      line-height: 1.5;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    a { color: var(--accent-hi); }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
    /* Micro-interaction: smooth all transitions */
    button, .btn, .nav-item, .panel, .metric, .icon-btn, .tag, input, select, textarea {
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* ── Shell ── */
    .app { display: flex; flex-direction: column; height: 100vh; }
    .topbar {
      height: var(--topbar-h);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      border-bottom: 1px solid var(--border);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
      gap: 12px;
      z-index: 40;
    }
    .topbar-left, .topbar-right, .topbar-mid {
      display: flex; align-items: center; gap: 10px; min-width: 0;
    }
    .brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .brand-logo {
      width: 30px; height: 30px; border-radius: 8px;
      background: var(--accent-dim); border: 1px solid var(--accent-border);
      display: grid; place-items: center;
      box-shadow: 0 0 12px var(--accent-glow);
      color: var(--accent);
    }
    .brand-logo svg { display: block; }
    .brand-name {
      font-weight: 700; font-size: 15px; letter-spacing: -0.02em;
    }
    .run-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 999px;
      background: var(--ok-dim); border: 1px solid var(--ok-border);
      color: var(--ok); font-size: 12px; font-weight: 600;
    }
    .run-pill.down {
      background: var(--err-dim); border-color: var(--err-border); color: var(--err);
    }
    .run-pill .dot {
      width: 6px; height: 6px; border-radius: 50%; background: currentColor;
      box-shadow: 0 0 8px currentColor;
      animation: pulse-glow 2s ease-in-out infinite;
    }
    @keyframes pulse-glow {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.3); }
    }
    .addr-box {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: var(--radius-sm);
      border: 1px solid var(--border); background: var(--glass-bg);
      backdrop-filter: blur(8px);
      font-family: var(--mono); font-size: 12px; color: var(--text-2);
      max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: grid; place-items: center;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border); background: var(--glass-bg);
      color: var(--text-2);
    }
    .icon-btn:hover {
      border-color: var(--accent-border); color: var(--accent-hi);
      background: var(--accent-dim); transform: translateY(-1px);
      box-shadow: 0 4px 12px var(--accent-glow);
    }
    .icon-btn:active { transform: translateY(0) scale(0.95); }
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
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
      border-right: 1px solid var(--border);
      display: flex; flex-direction: column;
      padding: 14px 0 10px;
    }
    .nav { display: flex; flex-direction: column; gap: 2px; padding: 0 10px; flex: 1; }
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      height: 38px; padding: 0 12px;
      border: none; border-radius: var(--radius-sm);
      background: transparent; color: var(--text-2);
      font-weight: 500; font-size: 13px; text-align: left; width: 100%;
      position: relative;
    }
    .nav-item svg { flex-shrink: 0; opacity: 0.8; }
    .nav-item:hover { background: var(--accent-dim); color: var(--text); }
    .nav-item.active {
      background: var(--accent-dim); color: var(--accent-hi);
      box-shadow: inset 0 0 0 1px var(--accent-border);
    }
    .nav-item.active::before {
      content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px;
      border-radius: 0 3px 3px 0; background: var(--accent);
      box-shadow: 0 0 8px var(--accent-glow);
    }
    .nav-item.active svg { color: var(--accent); opacity: 1; }
    .sidebar-foot {
      padding: 12px 16px 4px; border-top: 1px solid var(--border);
      color: var(--muted); font-size: 11px; line-height: 1.5;
    }
    .sidebar-foot .ver { font-family: var(--mono); color: var(--text-2); }

    .content {
      flex: 1; min-width: 0; overflow: auto;
      padding: 20px 24px 32px;
      background: var(--bg);
    }
    .page { display: none; }
    .page.active { display: block; animation: page-enter 0.35s ease-out; }
    @keyframes page-enter {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Typography / chrome ── */
    .page-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; margin-bottom: 18px; flex-wrap: wrap;
    }
    .page-head h1 {
      margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;
    }
    .page-head .sub {
      margin: 4px 0 0; color: var(--muted); font-size: 13px;
    }
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      height: 34px; padding: 0 14px;
      border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--glass-bg); backdrop-filter: blur(8px);
      color: var(--text); font-weight: 500; font-size: 13px;
      white-space: nowrap; position: relative; overflow: hidden;
    }
    .btn:hover {
      border-color: var(--accent-border); background: var(--accent-dim);
      transform: translateY(-1px); box-shadow: 0 4px 12px var(--accent-glow);
    }
    .btn:active { transform: translateY(0) scale(0.97); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
    .btn-primary {
      background: var(--accent); border-color: var(--accent); color: #fff;
      box-shadow: 0 2px 8px var(--accent-glow);
    }
    .btn-primary:hover {
      background: var(--accent-hi); border-color: var(--accent-hi);
      filter: brightness(1.1); box-shadow: 0 4px 16px var(--accent-glow);
    }
    .btn-danger {
      background: transparent; border-color: var(--err-border); color: var(--err);
    }
    .btn-danger:hover { background: var(--err-dim); box-shadow: 0 4px 12px rgba(239,68,68,0.15); }
    .btn-ghost { background: transparent; backdrop-filter: none; }
    .btn-sm { height: 30px; padding: 0 10px; font-size: 12px; }
    .btn-icon {
      width: 30px; height: 30px; padding: 0;
    }

    .panel {
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .panel-hd {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border);
      min-height: 44px;
    }
    .panel-hd h2, .panel-hd h3 {
      margin: 0; font-size: 13px; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
    }
    .panel-hd-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .collapse-toggle { width: 28px; padding: 0; font-size: 14px; }
    .collapsible-body.is-collapsed { display: none; }
    .metrics.is-collapsed { display: none; }
    .panel-bd { padding: 14px 16px; }
    .hint { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
    .mono { font-family: var(--mono); font-size: 12px; }
    .muted { color: var(--muted); }

    label.field {
      display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; font-weight: 500;
    }
    .input, .select, .textarea {
      width: 100%; height: 34px; padding: 0 12px;
      border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--bg); color: var(--text);
    }
    .textarea { height: auto; min-height: 72px; padding: 8px 12px; resize: vertical; }
    .input:focus, .select:focus, .textarea:focus {
      outline: none; border-color: var(--accent-border);
      box-shadow: 0 0 0 3px var(--accent-dim), 0 0 12px var(--accent-glow);
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
      padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--bg); margin-bottom: 10px;
    }
    .check-row input { margin-top: 2px; accent-color: var(--accent); }
    .check-row label { color: var(--text); font-size: 13px; cursor: pointer; }

    .tag {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 600; border: 1px solid var(--border); color: var(--muted);
      white-space: nowrap;
    }
    .tag.ok { background: var(--ok-dim); border-color: var(--ok-border); color: var(--ok); }
    .tag.warn { background: var(--warn-dim); border-color: var(--warn-border); color: var(--warn); }
    .tag.err { background: var(--err-dim); border-color: var(--err-border); color: var(--err); }
    .tag.blue { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent-hi); }
    .tag.info { background: rgba(255,255,255,0.04); }
    :root[data-theme="light"] .tag.info { background: rgba(15,23,42,0.04); }

    /* ── Metrics ── */
    .metrics {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 12px; margin-bottom: 16px;
    }
    .metric {
      background: var(--glass-bg);
      backdrop-filter: blur(12px) saturate(1.2);
      -webkit-backdrop-filter: blur(12px) saturate(1.2);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius); padding: 14px 14px 12px; min-height: 96px;
      display: flex; flex-direction: column; gap: 6px;
      position: relative; overflow: hidden;
      animation: metric-enter 0.4s ease-out backwards;
    }
    .metric:nth-child(1) { animation-delay: 0ms; }
    .metric:nth-child(2) { animation-delay: 60ms; }
    .metric:nth-child(3) { animation-delay: 120ms; }
    .metric:nth-child(4) { animation-delay: 180ms; }
    .metric:nth-child(5) { animation-delay: 240ms; }
    .metric:nth-child(6) { animation-delay: 300ms; }
    @keyframes metric-enter {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .metric::before {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent-glow), transparent);
      opacity: 0; transition: opacity 0.3s;
    }
    .metric:hover::before { opacity: 1; }
    .metric:hover {
      border-color: var(--accent-border);
      box-shadow: 0 4px 16px var(--accent-glow);
      transform: translateY(-2px);
    }
    .metric .k {
      display: flex; align-items: center; gap: 6px;
      font-size: 11px; color: var(--muted); font-weight: 500; text-transform: none;
    }
    .metric .k svg { opacity: 0.7; }
    .metric .v { font-size: 18px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
    .metric .v.ok { color: var(--ok); }
    .metric .v.blue { color: var(--accent-hi); }
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
      background: conic-gradient(var(--accent) var(--p, 0%), var(--border) 0);
      display: grid; place-items: center; flex-shrink: 0;
    }
    .donut::after {
      content: attr(data-pct);
      width: 30px; height: 30px; border-radius: 50%;
      background: var(--panel-solid); display: grid; place-items: center;
      font-size: 10px; font-weight: 600; font-family: var(--mono); color: var(--text-2);
    }
    .legend-dots { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); }
    .legend-dots span::before {
      content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
      margin-right: 5px; vertical-align: middle;
    }
    .legend-dots .r::before { background: var(--ok); }
    .legend-dots .b::before { background: var(--accent); }

    /* ── Accent switcher ── */
    .accent-switcher { display: flex; gap: 5px; align-items: center; }
    .accent-dot {
      width: 16px; height: 16px; border-radius: 50%; border: 2px solid transparent;
      cursor: pointer; transition: transform 0.15s, border-color 0.15s;
    }
    .accent-dot:hover { transform: scale(1.2); }
    .accent-dot.active { border-color: var(--text); transform: scale(1.15); }
    .accent-dot[data-accent="blue"] { background: #3b82f6; }
    .accent-dot[data-accent="violet"] { background: #7c3aed; }
    .accent-dot[data-accent="green"] { background: #10b981; }
    .accent-dot[data-accent="amber"] { background: #f59e0b; }

`;
