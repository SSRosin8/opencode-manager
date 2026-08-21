/** Source fragment for the self-contained admin console. */
export const ADMIN_CLIENT_PROXY_VIEWS = `    function renderMetrics(targetId) {
      const st = status || {};
      const pool = settings.proxyPool || [];
      const direct = pool.filter((p) => p.usable).length;
      const bridged = pool.filter((p) => !p.usable && p.bridgeable).length;
      const unavailable = Math.max(0, pool.length - direct - bridged);
      const total = pool.length;
      const ready = st.readyAccountCount ?? 0;
      const workers = st.accountCount ?? (settings.accounts || []).length;
      const enabledWorkers = st.enabledAccountCount ?? workers;
      const busy = Math.max(0, enabledWorkers - ready);
      const pct = enabledWorkers ? Math.round((ready / enabledWorkers) * 100) : 0;
      const running = !!st.running;
      const clashOn = !!st.clashBridgeEnabled || bridgeOn();

      const html = [
        { k: t("metricGateway"), v: running ? t("running") : t("stopped"), vcls: running ? "ok" : "", foot: '<span class="tag ' + (running ? 'ok' : 'err') + '">' + escapeHtml(running ? t("healthy") : t("stopped")) + '</span>', detail: t("metricGatewayDetail") },
        { k: t("metricWorkers"), v: ready + " / " + enabledWorkers, vcls: ready === enabledWorkers ? "ok" : "", foot: '<span class="metric-footline">' + escapeHtml(t("readyWorkers")) + '</span>', detail: t("metricWorkersDetail")(workers, enabledWorkers, ready, busy, pct) },
        { k: t("metricProxyNodes"), v: String(total), vcls: "blue", foot: '<span class="metric-footline">' + escapeHtml(t("availableRoutes")) + '</span>', detail: t("metricProxyDetail")(direct, bridged, unavailable) },
        { k: t("metricClash"), v: clashOn ? t("enabled") : t("disabled"), vcls: clashOn ? "ok" : "", foot: clashOn ? '<span class="tag ok">' + escapeHtml(bridgeProbeOk === false ? t("disconnected") : t("connected")) + '</span>' : '<span class="tag">' + escapeHtml(t("disabled")) + '</span>', detail: t("metricClashDetail") },
      ].map((m, index) => '<div class="metric metric-detail" tabindex="0" data-metric-index="' + index + '"><div class="k">' + escapeHtml(m.k) + '</div><div class="v ' + m.vcls + '">' + escapeHtml(m.v) + '</div><div class="foot">' + m.foot + '</div><div class="metric-popover" role="tooltip">' + escapeHtml(m.detail) + '</div></div>').join("");
      $(targetId).innerHTML = html;
    }

    function patchWorkerMetric(targetId) {
      const metric = $(targetId)?.querySelector?.('[data-metric-index="1"]');
      if (!metric) return;
      const workers = status?.accountCount ?? (settings.accounts || []).length;
      const enabled = status?.enabledAccountCount ?? workers;
      const ready = status?.readyAccountCount ?? 0;
      const busy = Math.max(0, enabled - ready);
      const pct = enabled ? Math.round((ready / enabled) * 100) : 0;
      const value = metric.querySelector(".v");
      const donut = metric.querySelector(".donut");
      const readyLabel = metric.querySelector(".legend-dots .r");
      const busyLabel = metric.querySelector(".legend-dots .b");
      if (value) value.textContent = ready + " / " + enabled;
      if (donut) donut.remove();
      if (readyLabel) readyLabel.textContent = t("readyWorkers");
      if (busyLabel) busyLabel.remove();
      const detail = metric.querySelector(".metric-popover");
      if (detail) detail.textContent = t("metricWorkersDetail")(workers, enabled, ready, busy, pct);
    }

    function patchBatchWorkerMetrics() {
      patchWorkerMetric("pp-metrics");
      patchWorkerMetric("ov-metrics");
    }

    function readinessFallback() {
      const pool = settings?.proxyPool || [];
      const workers = (settings?.accounts || []).filter((account) => account.enabled !== false);
      const healthy = pool.filter((proxy) => nodeHealth(proxy) === "healthy").length;
      const healthyIds = new Set(pool.filter((proxy) => nodeHealth(proxy) === "healthy").map((proxy) => proxy.id));
      const bridgeNeeded = pool.some((proxy) => !proxy.usable && proxy.bridgeable);
      const bound = workers.filter((worker) => worker.proxyId && healthyIds.has(worker.proxyId)).length;
      if (!pool.length) return { level: "warn", title: t("readinessAddSource"), detail: t("readinessAddSourceDetail"), action: "sources" };
      if (!healthy && bridgeNeeded && !bridgeOn()) return { level: "warn", title: t("readinessEnableBridge"), detail: t("readinessEnableBridgeDetail"), action: "sources" };
      if (!healthy) return { level: "warn", title: t("readinessTestNodes"), detail: t("readinessTestNodesDetail"), action: "nodes" };
      if (!workers.length || bound < workers.length) return { level: "warn", title: t("readinessBindWorkers"), detail: t("readinessBindWorkersDetail"), action: "bindings" };
      return { level: "ok", title: t("readinessReady"), detail: t("readinessReadyDetail"), action: "bindings" };
    }

    function renderReadiness() {
      const supplied = status?.readiness;
      const fallback = readinessFallback();
      const actionMap = { add_proxy_source: "sources", configure_clash_bridge: "sources", run_batch_probe: "nodes", review_workers: "bindings", ready: "bindings" };
      const value = supplied && typeof supplied === "object" ? {
        level: supplied.operational ? "ok" : "warn",
        title: t(({ add_proxy_source: "readinessAddSource", configure_clash_bridge: "readinessEnableBridge", run_batch_probe: "readinessTestNodes", review_workers: "readinessBindWorkers", ready: "readinessReady" })[supplied.nextAction] || "readinessTestNodes"),
        detail: t(({ add_proxy_source: "readinessAddSourceDetail", configure_clash_bridge: "readinessEnableBridgeDetail", run_batch_probe: "readinessTestNodesDetail", review_workers: "readinessBindWorkersDetail", ready: "readinessReadyDetail" })[supplied.nextAction] || "readinessTestNodesDetail"),
        action: actionMap[supplied.nextAction] || fallback.action,
      } : fallback;
      const action = ["nodes", "sources", "bindings", "workers"].includes(value.action) ? value.action : fallback.action;
      const label = action === "sources" ? t("goToSources") : action === "nodes" ? t("goToNodes") : t("goToBindings");
      $("proxy-readiness").className = "readiness-band " + (value.level === "ok" ? "ok" : "warn");
      $("proxy-readiness").innerHTML = '<div class="readiness-copy"><div class="readiness-title">' + escapeHtml(value.title) + '</div><div class="readiness-detail">' + escapeHtml(value.detail) + '</div></div>' +
        '<button type="button" class="btn btn-sm" id="btn-readiness-action" data-action="' + escapeAttr(action) + '">' + escapeHtml(label) + '</button>';
      $("btn-readiness-action").onclick = () => {
        if (action === "workers") showPage("workers");
        else showProxyTab(action);
      };
    }

    function renderIsolation() {
      const rows = isolationRows();
      const isolation = pageSlice(rows, isolationPage);
      isolationPage = isolation.page;
      const root = $("iso-rows");
      if (!rows.length) {
        root.innerHTML = '<p class="hint">' + escapeHtml(t("noWorkers")) + '</p>';
      } else {
        root.innerHTML = isolation.items.map(({ a, idx, p, probe, shared, state }) => {
          const showBridge = p && p.bridgeable && !p.usable;
          const egressCls = shared || !p ? "shared" : "";
          const egressTitle = !p
            ? t("sharedIp")
            : (shared ? t("sharedIp") : (probe?.egressIp || p.egressIp || "—"));
          const egressSub = !p
            ? t("multipleWorkers")
            : (shared ? t("multipleWorkers") : ((probe?.egressIp || p.egressIp) ? (p.type + " · " + p.port) : t("notTested")));
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
        '<button type="button" class="btn btn-sm" id="btn-review-bind" style="border-color:var(--accent-border);color:var(--accent-hi)">' + escapeHtml(t("reviewBindings")) + '</button>';
      const btn = $("btn-review-bind");
      if (btn) btn.onclick = () => showPage("workers");
      $("iso-updated").textContent = t("lastUpdated");
      const pagination = $("iso-pagination");
      pagination.hidden = rows.length <= PAGE_SIZE;
      $("iso-page-summary").textContent = rows.length
        ? t("pageSummary")((isolation.page - 1) * PAGE_SIZE + 1, Math.min(isolation.page * PAGE_SIZE, rows.length), rows.length)
        : "";
      $("iso-pager").innerHTML = pagerHtml(isolation.page, isolation.totalPages);
      bindPager($("iso-pager"), isolation.totalPages, (nextPage) => { isolationPage = nextPage; renderIsolation(); });
    }

    function renderSubs() {
      const list = settings.proxySubscriptions || [];
      const root = $("sub-grid");
      $("btn-fetch-all").hidden = list.length < 2;
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
        const diagnostics = subscriptionDiagnostics.get(s.id) || {};
        const format = diagnostics.format || s.lastFormat || t("unavailableShort");
        const userAgent = diagnostics.usedUserAgent || s.lastUserAgent || t("unavailableShort");
        const rawBytes = diagnostics.rawBytes ?? s.lastRawBytes ?? t("unavailableShort");
        const parsed = diagnostics.totalCount ?? s.lastImportCount ?? pool.length;
        return '<div class="sub-card' + (err ? ' err' : '') + '">' +
          '<div class="top"><div class="name">' + escapeHtml(s.name) + '</div>' +
          (err ? '<span class="tag err">Error</span>' : ok ? '<span class="tag ok">OK</span>' : '<span class="tag">—</span>') +
          '</div>' +
          '<div class="url"><span title="' + escapeAttr(s.url) + '">' + escapeHtml(s.url) + '</span>' +
          '<button type="button" class="btn btn-sm btn-icon btn-copy-url" data-url="' + escapeAttr(s.url) + '" title="Copy">⧉</button></div>' +
          '<div class="meta"><span>' + escapeHtml(t("lastPulled") + ": " + relTime(s.lastFetchedAt)) + '</span>' +
          '<span>' + (s.lastImportCount || pool.length || 0) + ' ' + escapeHtml(t("nodes")) + '</span></div>' +
          '<div class="diagnostics"><span>' + escapeHtml(t("diagFormat")) + '</span><b>' + escapeHtml(format) + '</b>' +
          '<span>' + escapeHtml(t("diagUserAgent")) + '</span><b title="' + escapeAttr(userAgent) + '">' + escapeHtml(userAgent) + '</b>' +
          '<span>' + escapeHtml(t("diagRawBytes")) + '</span><b>' + escapeHtml(rawBytes) + '</b>' +
          '<span>' + escapeHtml(t("diagParsed")) + '</span><b>' + escapeHtml(String(parsed)) + '</b></div>' +
          (types.length ? '<div class="proto">' + escapeHtml(types.slice(0, 5).join(", ")) + '</div>' : '') +
          (err ? '<div class="err-msg">' + escapeHtml(s.lastError) + '</div>' : '') +
          '<div class="acts">' +
          '<button type="button" class="btn btn-sm btn-fetch-sub" data-id="' + escapeAttr(s.id) + '">' + escapeHtml(t("syncSubscription")) + '</button>' +
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
            subscriptionDiagnostics.set(btn.dataset.id, data);
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
            '<button type="button" class="btn btn-sm btn-danger btn-del-px" data-id="' + escapeAttr(p.id) + '" data-name="' + escapeAttr(p.name) + '"' + (batchTesting ? " disabled" : "") + '>' + escapeHtml(t("del")) + '</button></td></tr>';
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
      const removeAll = $("btn-remove-all-proxies");
      if (removeAll) removeAll.disabled = !all.length || batchTesting;
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
      pager.innerHTML = pagerHtml(nodePage, totalPages);
      bindPager(pager, totalPages, (nextPage) => { nodePage = nextPage; renderNodes(); });
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

`;
