/** Source fragment for the self-contained admin console. */
export const ADMIN_CLIENT_WORKER_VIEWS = `    function renderAccounts() {
      const root = $("accounts");
      const list = settings.accounts || [];
      const strategy = $("routing-strategy");
      if (strategy) strategy.value = settings.routingStrategy || "anonymous_first";
      const renderCard = (a, idx, hidden) => {
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
        const displayName = kind === "anonymous_zen"
          ? t("anonymousWorkerName")(idx + 1)
          : "Worker " + (idx + 1) + " · " + (a.id || t("unassigned"));
        return '<div class="worker-card' + (enabled ? '' : ' disabled-worker') + '" data-idx="' + idx + '" data-worker-key="' + escapeAttr(collapseKey) + '"' + (hidden ? ' hidden' : '') + '>' +
          '<div class="hd"><span class="worker-title" title="' + escapeAttr(a.id || displayName) + '">' + escapeHtml(displayName) + (enabled ? '' : ' · ' + escapeHtml(t("disabledState"))) + '</span>' +
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
        const pageData = pageSlice(items, workerPages[kind]);
        workerPages[kind] = pageData.page;
        return '<section class="worker-column" data-worker-kind="' + kind + '">' +
          '<div class="worker-column-hd"><span>' + escapeHtml(t(titleKey)) +
          ' <span class="worker-column-count">' + items.length + '</span></span>' +
          '<button type="button" class="btn btn-sm btn-danger btn-remove-worker-group" data-kind="' + kind + '"' +
          (items.length ? '' : ' disabled') + '>' + escapeHtml(t("removeGroupWorkers")) + '</button></div>' +
          '<div class="worker-column-list">' +
          (items.length ? items.map(({ account, idx }, position) => renderCard(account, idx, position < (pageData.page - 1) * PAGE_SIZE || position >= pageData.page * PAGE_SIZE)).join("") :
            '<p class="worker-column-empty">' + escapeHtml(t(emptyKey)) + '</p>') +
          '</div>' +
          '<div class="table-foot list-pagination worker-pagination"' + (items.length <= PAGE_SIZE ? ' hidden' : '') + '>' +
          '<div class="sum">' + (items.length ? escapeHtml(t("pageSummary")((pageData.page - 1) * PAGE_SIZE + 1, Math.min(pageData.page * PAGE_SIZE, items.length), items.length)) : '') + '</div>' +
          '<div class="pager">' + pagerHtml(pageData.page, pageData.totalPages) + '</div></div></section>';
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
      root.querySelectorAll(".worker-column").forEach((column) => {
        const kind = column.dataset.workerKind;
        const total = indexed.filter(({ account }) => {
          const accountKind = account.kind === "authenticated_zen" || (!account.kind && String(account.apiKey || "").trim()) ? "authenticated_zen" : "anonymous_zen";
          return accountKind === kind;
        }).length;
        bindPager(column.querySelector(".pager"), Math.max(1, Math.ceil(total / PAGE_SIZE)), (nextPage) => {
          settings.accounts = collectAccounts();
          workerPages[kind] = nextPage;
          renderAccounts();
        });
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
      document.querySelectorAll("#accounts .worker-column-list").forEach((list) => list.classList.remove("worker-list-scroll"));
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
      const summary = $("ov-usage-summary");
      const toggleIdle = $("ov-toggle-idle");
      if (!body) return;
      const workers = status?.workers || [];
      const totals = status?.usageTotals || {};
      const generationRequests = Number(totals.generationRequestCount ?? totals.generationAttemptCount ?? totals.chatCount ?? 0);
      const generationSuccess = Number(totals.generationCompletedSuccessCount ?? totals.generationSuccessCount ?? 0);
      const generationErrors = Number(totals.generationCompletedErrorCount ?? totals.generationErrorCount ?? 0);
      const finishedCount = generationSuccess + generationErrors;
      const modelUsageText = Object.entries(totals.modelUsage || {}).map(([model, count]) => model + " × " + fmtNum(count)).join(", ") || "—";
      const modelStatsText = (stats) => Object.entries(stats.modelTokenUsage || {}).map(([model, usage]) =>
        t("modelStatsItem")(model, fmtNum(usage.requestCount), fmtNum(usage.totalTokens), fmtRate(usage.promptTokens ? usage.cacheReadTokens / usage.promptTokens : null))
      ).join("\\n") || "—";
      const usageDetailText = (stats) => Number(stats.usageReportedCount || 0) + Number(stats.usageMissingCount || 0) > 0 || !Number(stats.totalTokens || 0)
        ? t("usageDetail")(fmtNum(stats.promptTokens), fmtNum(stats.completionTokens), fmtNum(stats.usageReportedCount), fmtNum(stats.usageMissingCount))
        : t("usageDetailLegacy")(fmtNum(stats.promptTokens), fmtNum(stats.completionTokens));
      const coverageKnown = Number(totals.usageReportedCount || 0) + Number(totals.usageMissingCount || 0) > 0 || !Number(totals.totalTokens || 0);
      const coverageText = coverageKnown
        ? t("coverageKnown")(fmtNum(totals.usageReportedCount), fmtNum(totals.usageMissingCount))
        : t("coverageUnknown");
      const otherInput = Math.max(0, Number(totals.promptTokens || 0) - Number(totals.cacheReadTokens || 0));
      if (summary) {
        summary.innerHTML = [
          [t("summaryAttempts"), fmtNum(generationRequests), t("modelDetail")(fmtNum(totals.generationAttemptCount), fmtNum(totals.modelsCount), fmtNum(totals.distinctModelCount), modelUsageText) + "\\n" + modelStatsText(totals)],
          [t("summarySuccessRate"), finishedCount ? fmtRate(generationSuccess / finishedCount) : "—", t("successDetail")(fmtNum(generationSuccess), fmtNum(generationErrors))],
          [t("summaryTokens"), fmtNum(totals.totalTokens), usageDetailText(totals)],
          [t("summaryCacheRate"), fmtRate(totals.cacheRate), t("cacheFormula")(fmtNum(totals.cacheReadTokens), fmtNum(otherInput), fmtNum(totals.cacheWriteTokens), coverageText)],
        ].map((item) => '<div class="usage-summary-item" tabindex="0"><div class="label">' + escapeHtml(item[0]) + '</div><div class="value">' + escapeHtml(item[1]) + '</div><div class="detail">' + escapeHtml(item[2]) + '</div><div class="usage-summary-popover" role="tooltip">' + escapeHtml(item[2]) + '</div></div>').join("");
      }
      const idleWorkers = workers.filter((worker) => !worker.requestCount && worker.ready && worker.enabled);
      const visibleWorkers = showIdleWorkers ? workers : workers.filter((worker) => worker.requestCount || !worker.ready || !worker.enabled);
      const workerPageData = pageSlice(visibleWorkers, overviewWorkerPage);
      overviewWorkerPage = workerPageData.page;
      toggleIdle.hidden = idleWorkers.length === 0;
      toggleIdle.textContent = showIdleWorkers ? t("hideIdleWorkers") : t("showIdleWorkers")(idleWorkers.length);
      toggleIdle.onclick = () => { showIdleWorkers = !showIdleWorkers; renderWorkerStats(); };
      if (!workers.length) {
        body.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px">' + escapeHtml(t("noWorkers")) + '</td></tr>';
      } else if (!visibleWorkers.length) {
        body.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px">' + escapeHtml(t("idleWorkersSummary")(idleWorkers.length)) + '</td></tr>';
      } else {
        body.innerHTML = workerPageData.items.map((w) => {
          const kindLabel = t(w.kind === "authenticated_zen" ? "authenticatedZen" : "anonymousZen");
          const routeName = w.proxyName || (w.proxyId ? w.proxyId : t("directEgress"));
          const egress = w.egressIp || t("unknownEgress");
          const stateLabel = !w.enabled ? t("disabledState") : w.ready ? t("readyState") : t("coolingState");
          const attemptModelUsage = w.modelAttemptUsage || w.modelUsage || {};
          const attemptModelText = Object.entries(attemptModelUsage).map(([model, count]) => model + " × " + fmtNum(count)).join(", ") || "—";
          return '<tr>' +
            '<td title="' + escapeAttr(w.accountId) + '"><div class="worker-route-primary"><strong>' + escapeHtml(routeName) + '</strong></div><div class="muted mono">' + escapeHtml(egress) + '</div><div class="worker-meta"><span class="tag ' + (w.kind === "anonymous_zen" ? "blue" : "info") + '">' + escapeHtml(kindLabel) + '</span></div></td>' +
            '<td class="mono" title="' + escapeAttr(t("workerModelDetail")(fmtNum(w.generationAttemptCount), fmtNum(w.modelsCount), fmtNum(Object.keys(attemptModelUsage).length), attemptModelText) + "\\n" + modelStatsText(w)) + '"><span class="mobile-cell-label">' + escapeHtml(t("colRequests")) + '</span><strong>' + fmtNum(w.generationAttemptCount ?? w.chatCount ?? 0) + '</strong></td>' +
            '<td class="mono"><span class="mobile-cell-label">' + escapeHtml(t("colSuccess")) + '</span><strong class="ok">' + fmtNum(w.generationSuccessCount ?? 0) + '</strong></td>' +
            '<td class="mono"><span class="mobile-cell-label">' + escapeHtml(t("colFailures")) + '</span><strong class="err">' + fmtNum(w.generationErrorCount ?? 0) + '</strong></td>' +
            '<td class="mono" title="' + escapeAttr(usageDetailText(w)) + '"><span class="mobile-cell-label">' + escapeHtml(t("colTokens")) + '</span><strong>' + fmtNum(w.totalTokens) + '</strong></td>' +
            '<td class="mono" title="' + escapeAttr(t("cacheBreakdown")(fmtNum(w.cacheReadTokens), fmtNum(w.cacheMissTokens), fmtNum(w.cacheWriteTokens))) + '"><span class="mobile-cell-label">' + escapeHtml(t("colCache")) + '</span>' + escapeHtml(fmtRate(w.cacheRate)) + '</td>' +
            '<td><span class="mobile-cell-label">' + escapeHtml(t("colState")) + '</span><span class="tag ' + (!w.enabled ? "" : w.ready ? "ok" : "warn") + '">' + escapeHtml(stateLabel) + '</span>' + (w.enabled && !w.ready && w.cooldownUntil ? '<div class="muted">' + escapeHtml(relTime(new Date(w.cooldownUntil).toISOString())) + '</div>' : '') + '</td>' +
            '<td class="muted"><span class="mobile-cell-label">' + escapeHtml(t("colLastReq")) + '</span>' + escapeHtml(w.lastRequestAt ? relTime(w.lastRequestAt) : "—") + '</td>' +
            '</tr>';
        }).join("");
      }
      const workerPagination = $("ov-workers-pagination");
      workerPagination.hidden = visibleWorkers.length <= PAGE_SIZE;
      $("ov-workers-page-summary").textContent = visibleWorkers.length
        ? t("pageSummary")((workerPageData.page - 1) * PAGE_SIZE + 1, Math.min(workerPageData.page * PAGE_SIZE, visibleWorkers.length), visibleWorkers.length)
        : "";
      $("ov-workers-pager").innerHTML = pagerHtml(workerPageData.page, workerPageData.totalPages);
      bindPager($("ov-workers-pager"), workerPageData.totalPages, (nextPage) => { overviewWorkerPage = nextPage; renderWorkerStats(); });

      const attempts = status?.recentAttempts || [];
      const attemptPageData = pageSlice(attempts, attemptPage);
      attemptPage = attemptPageData.page;
      if (!attemptsBody) return;
      if (!attempts.length) {
        attemptsBody.innerHTML = '<tr><td colspan="6" class="muted" style="padding:14px">' + escapeHtml(t("noAttempts")) + '</td></tr>';
        $("ov-attempts-pagination").hidden = true;
        return;
      }
      const outcomeText = {
        success: "outcomeSuccess",
        rate_limited: "outcomeRateLimit",
        auth_failed: "outcomeAuthFailed",
        upstream_error: "outcomeUpstreamError",
        transport_error: "outcomeTransportError",
      };
      attemptsBody.innerHTML = attemptPageData.items.map((a) => {
        const ok = a.outcome === "success";
        const warn = a.outcome === "rate_limited" || a.outcome === "upstream_error";
        const resultClass = ok ? "ok" : warn ? "warn" : "err";
        const resultLabel = t(outcomeText[a.outcome] || "outcomeUpstreamError");
        const kindLabel = t(a.accountKind === "authenticated_zen" ? "authenticatedZen" : "anonymousZen");
        const route = a.proxyName || a.clashNodeName || a.proxyId || t("directEgress");
        const egress = a.egressIp || t("unknownEgress");
        const statusLabel = a.status == null ? resultLabel : "HTTP " + a.status + " · " + resultLabel;
        return '<tr class="' + (ok ? "" : warn ? "row-warn" : "row-err") + '">' +
          '<td><span class="mono">' + escapeHtml(String(a.requestId || "").slice(0, 8)) + '</span><div class="muted attempt-position" title="' + escapeAttr(t("attemptPositionHint")) + '">' + escapeHtml(t("attemptPosition")(a.attempt, a.maxAttempts)) + '</div><div class="muted">' + escapeHtml(relTime(a.at)) + '</div></td>' +
          '<td><strong>' + escapeHtml(a.operation) + '</strong><div class="muted mono">' + escapeHtml(a.model || "—") + '</div></td>' +
          '<td title="' + escapeAttr(a.accountId) + '"><div class="worker-route-primary"><strong>' + escapeHtml(route) + '</strong></div><div class="muted mono">' + escapeHtml(egress) + '</div><div class="worker-meta"><span class="tag ' + (a.accountKind === "anonymous_zen" ? "blue" : "info") + '">' + escapeHtml(kindLabel) + '</span></div></td>' +
          '<td><span class="tag ' + resultClass + '">' + escapeHtml(statusLabel) + '</span>' + (a.error ? '<div class="attempt-error" title="' + escapeAttr(a.error) + '">' + escapeHtml(a.error) + '</div>' : '') + '</td>' +
          '<td class="mono">' + fmtNum(a.latencyMs) + ' ms</td>' +
          '<td><span class="tag ' + (a.willRetry ? "warn" : ok ? "ok" : "err") + '">' + escapeHtml(a.willRetry ? t("retrying") : ok ? t("returned") : t("noRetry")) + '</span></td>' +
          '</tr>';
        }).join("");
      const attemptsPagination = $("ov-attempts-pagination");
      attemptsPagination.hidden = attempts.length <= PAGE_SIZE;
      $("ov-attempts-page-summary").textContent = t("pageSummary")((attemptPageData.page - 1) * PAGE_SIZE + 1, Math.min(attemptPageData.page * PAGE_SIZE, attempts.length), attempts.length);
      $("ov-attempts-pager").innerHTML = pagerHtml(attemptPageData.page, attemptPageData.totalPages);
      bindPager($("ov-attempts-pager"), attemptPageData.totalPages, (nextPage) => { attemptPage = nextPage; renderWorkerStats(); });
    }

    function renderStatusChrome() {
      const running = !!(status && status.running);
      const pill = $("run-pill");
      pill.className = "run-pill" + (running ? "" : " down");
      $("run-label").textContent = running ? t("running") : t("stopped");
      $("addr-box").textContent = location.origin;
      $("usage-base").textContent = location.origin + "/v1";

      renderWorkerStats();

      // Requests rejected by the gateway are separate from upstream Worker attempts.
      const rejections = status?.recentGatewayRejections || [];
      const rejectionPageData = pageSlice(rejections, rejectionPage);
      rejectionPage = rejectionPageData.page;
      const rejectionLabels = {
        not_found: "rejectionNotFound",
        model_not_allowed: "rejectionModelNotAllowed",
        invalid_request_error: "rejectionInvalidRequest",
        no_workers_configured: "rejectionNoWorkers",
        no_enabled_workers: "rejectionNoEnabledWorkers",
        authentication_error: "rejectionAuthentication",
        request_body_too_large: "rejectionBodyTooLarge",
        server_error: "rejectionServerError",
      };
      $("overview-errors-panel").hidden = rejections.length === 0;
      $("ov-errors").innerHTML = rejections.length
        ? rejectionPageData.items.map((event) => {
          const label = t(rejectionLabels[event.type] || "gatewayRejected");
          const request = String(event.requestId || "").slice(0, 8);
          const detail = event.method + " " + event.path + (event.model ? " · " + event.model : "");
          return '<li><i class="dot err"></i><div><div class="title">' + escapeHtml(label) + ' <span class="tag err">HTTP ' + escapeHtml(event.status) + '</span></div><div class="sub mono">' + escapeHtml(detail) + '</div><div class="sub mono">' + escapeHtml(request) + '</div></div><div class="time">' + escapeHtml(relTime(event.at)) + '</div></li>';
        }).join("")
        : '<li style="grid-template-columns:1fr"><span class="muted">' + escapeHtml(t("none")) + '</span></li>';
      const rejectionPagination = $("ov-errors-pagination");
      rejectionPagination.hidden = rejections.length <= PAGE_SIZE;
      $("ov-errors-page-summary").textContent = rejections.length
        ? t("pageSummary")((rejectionPageData.page - 1) * PAGE_SIZE + 1, Math.min(rejectionPageData.page * PAGE_SIZE, rejections.length), rejections.length)
        : "";
      $("ov-errors-pager").innerHTML = pagerHtml(rejectionPageData.page, rejectionPageData.totalPages);
      bindPager($("ov-errors-pager"), rejectionPageData.totalPages, (nextPage) => { rejectionPage = nextPage; renderStatusChrome(); });
    }

    function renderAll() {
      fillGateway();
      renderBridge();
      renderMetrics("pp-metrics");
      renderMetrics("ov-metrics");
      renderReadiness();
      renderIsolation();
      renderSubs();
      renderNodes();
      renderActivity();
      renderUnassigned();
      renderAccounts();
      renderStatusChrome();
      showProxyTab(proxyTab);
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
    $("btn-add-source").onclick = (e) => {
      e.stopPropagation();
      const menu = $("add-source-menu");
      const open = menu.classList.toggle("show");
      $("btn-add-source").setAttribute("aria-expanded", String(open));
    };
    $("menu-add-proxy").onclick = () => openModal("modal-proxy");
    $("menu-add-subscription").onclick = () => openModal("modal-sub");
    $("modal-proxy-cancel").onclick = () => closeModal("modal-proxy");
    $("modal-sub-cancel").onclick = () => closeModal("modal-sub");
    $("modal-proxy").addEventListener("click", (e) => { if (e.target.id === "modal-proxy") closeModal("modal-proxy"); });
    $("modal-sub").addEventListener("click", (e) => { if (e.target.id === "modal-sub") closeModal("modal-sub"); });

    $("btn-more").onclick = (e) => {
      e.stopPropagation();
      $("more-menu").classList.toggle("show");
    };
    document.addEventListener("click", () => {
      $("more-menu").classList.remove("show");
      $("add-source-menu").classList.remove("show");
      $("btn-add-source").setAttribute("aria-expanded", "false");
    });
    $("menu-refresh").onclick = () => refreshAll();
    $("menu-goto-workers").onclick = () => showPage("workers");
    document.querySelectorAll(".proxy-tab").forEach((button) => {
      button.onclick = () => showProxyTab(button.dataset.proxyTab);
    });

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
