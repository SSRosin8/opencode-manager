/** Source fragment for the self-contained admin console. */
export const ADMIN_MARKUP = `</head>
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
              <button type="button" class="btn" id="btn-add-account" data-i18n="addAuthenticatedWorker">Add signed-in Worker</button>
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

`;
