/** Source fragment for the self-contained admin console. */
export const ADMIN_CLIENT_WORKER_VIEWS = `    function renderAccounts() {
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
          openConfirm(t("confirmRemoveWorkerGroup")(label), t("confirmRemoveWorkerGroupBody")(label), async () => {
            const drafts = collectAccounts();
            const remaining = drafts.filter((account) => account.kind !== kind);
            if (!await persistWorkerAccounts(remaining)) return;
            for (const account of drafts) {
              if (account.kind === kind) collapsedWorkerIds.delete(String(account.id));
            }
            persistCollapsedWorkers();
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

    async function persistWorkerAccounts(accounts) {
      const body = {
        ...settings,
        routingStrategy: $("routing-strategy")?.value || settings.routingStrategy || "anonymous_first",
        accounts,
      };
      try {
        const res = await fetch("/admin/api/settings", {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || t("toastSaveFail"));
        }
        settings = await res.json();
        serverAccountIds = new Set((settings.accounts || []).map((account) => account.id));
        await loadStatus();
        renderAll();
        return true;
      } catch (error) {
        toast(String(error.message || error), false);
        return false;
      }
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

`;
