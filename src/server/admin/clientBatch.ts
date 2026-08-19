/** Source fragment for the self-contained admin console. */
export const ADMIN_CLIENT_BATCH = `    async function loadSettings() {
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
      acceptBatchProgress(data.batchProbe);
    }

    function acceptBatchProgress(progress) {
      if (!progress) return false;
      const currentStarted = batchProgress?.startedAt || "";
      const nextStarted = progress.startedAt || "";
      const currentUpdated = batchProgress?.updatedAt || "";
      const nextUpdated = progress.updatedAt || "";
      if (currentStarted && nextStarted && nextStarted < currentStarted) return false;
      if (nextStarted === currentStarted && currentUpdated && nextUpdated < currentUpdated) return false;
      batchProgress = progress;
      return true;
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
      if (batchProgressAbort) batchProgressAbort.abort();
      batchProgressAbort = null;
    }

    function scheduleBatchProgressPoll(delay = 500) {
      stopBatchProgressPolling();
      const generation = batchPollGeneration;
      batchProgressTimer = setTimeout(async () => {
        batchProgressTimer = null;
        await pollBatchProgress(generation);
        if (batchTesting && generation === batchPollGeneration) scheduleBatchProgressPoll();
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

    async function pollBatchProgress(generation = batchPollGeneration) {
      const controller = new AbortController();
      batchProgressAbort = controller;
      try {
        const res = await fetch("/admin/api/proxy-pool", { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const poolState = await res.json();
        if (generation !== batchPollGeneration || controller.signal.aborted) return;
        const progress = poolState.batchProbe;
        if (!acceptBatchProgress(progress)) return;
        if (poolState.probeResults) probeResults = poolState.probeResults;
        if (progress?.running) batchProgressSeenRunning = true;
        updateBatchProgress(progress);
        renderMetrics("pp-metrics");
        renderMetrics("ov-metrics");
        renderIsolation();
        const addedWorkerCount = progress?.addedWorkerIds?.length || 0;
        if (addedWorkerCount > lastBatchRenderedWorkerCount) {
          await reloadAfterBatchPreservingDrafts(false);
          if (generation !== batchPollGeneration || controller.signal.aborted) return;
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
      } finally {
        if (batchProgressAbort === controller) batchProgressAbort = null;
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
        acceptBatchProgress(data.progress);
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
      batchPollGeneration += 1;
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
        acceptBatchProgress(data.progress);
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
        await pollBatchProgress();
        if (batchProgress?.running) {
          batchTesting = true;
          batchProgressSeenRunning = true;
          scheduleBatchProgressPoll();
          updateBatchProgress(batchProgress);
        } else {
          batchPollGeneration += 1;
          stopBatchProgressPolling();
          testingIds.clear();
          batchTesting = false;
          batchProgressSeenRunning = false;
          const finishedProgress = { ...(batchProgress || {}), running: false };
          batchProgress = finishedProgress;
          updateBatchProgress(finishedProgress);
          if (btn) btn.textContent = t("batchTest");
          renderNodes();
          renderActivity();
        }
      }
    }

`;
