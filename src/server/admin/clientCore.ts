/** Source fragment for the self-contained admin console. */
export const ADMIN_CLIENT_CORE = `    function storageGet(key) {
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
    let batchProgressAbort = null;
    let batchPollGeneration = 0;
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

    function setAccent(accent) {
      if (accent === "blue") {
        delete document.documentElement.dataset.accent;
        storageSet("ocfr-accent", "");
      } else {
        document.documentElement.dataset.accent = accent;
        storageSet("ocfr-accent", accent);
      }
      document.querySelectorAll(".accent-dot").forEach((d) => {
        d.classList.toggle("active", d.dataset.accent === accent);
      });
    }

    function initAccentSwitcher() {
      const current = storageGet("ocfr-accent") || "blue";
      document.querySelectorAll(".accent-dot").forEach((d) => {
        d.classList.toggle("active", d.dataset.accent === current);
        d.onclick = () => setAccent(d.dataset.accent);
      });
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

`;
