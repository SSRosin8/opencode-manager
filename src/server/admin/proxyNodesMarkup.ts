/** Proxy-node table fragment for the self-contained admin console. */
export const ADMIN_PROXY_NODES_MARKUP = `              <div class="panel" data-proxy-section="nodes">
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
                    <select class="select" id="flt-proto"><option value="" data-i18n="allProtocols">All Protocols</option></select>
                    <select class="select" id="flt-source">
                      <option value="" data-i18n="allSources">All Sources</option>
                      <option value="manual" data-i18n="srcManual">Manual</option>
                      <option value="subscription" data-i18n="srcSub">Subscription</option>
                      <option value="controller" data-i18n="srcController">Controller</option>
                    </select>
                    <select class="select" id="flt-route-health">
                      <option value="" data-i18n="allConnectivity">All connectivity</option>
                      <option value="reachable" data-i18n="routeReachable">Reachable</option>
                      <option value="unreachable" data-i18n="routeUnreachable">Unreachable</option>
                      <option value="config_error" data-i18n="routeConfigError">Configuration needed</option>
                      <option value="untested" data-i18n="routeUntested">Not tested</option>
                    </select>
                    <select class="select" id="flt-zen-health">
                      <option value="" data-i18n="allZenStatus">All Zen status</option>
                      <option value="usable" data-i18n="zenUsable">Anonymous Zen usable</option>
                      <option value="rate_limited" data-i18n="zenRateLimited">Zen rate limited</option>
                      <option value="blocked" data-i18n="zenBlocked">Zen blocked</option>
                      <option value="temporary_failure" data-i18n="zenTemporary">Zen temporary failure</option>
                      <option value="unreachable" data-i18n="zenUnreachable">Zen unreachable</option>
                      <option value="unverified" data-i18n="zenUnverified">Zen unverified</option>
                    </select>
                    <button type="button" class="btn btn-sm" id="btn-batch-test" data-i18n="batchTest">Batch Test</button>
                    <button type="button" class="btn btn-sm" id="btn-batch-pause" data-i18n="pauseBatch" hidden>Pause</button>
                    <button type="button" class="btn btn-sm btn-danger" id="btn-batch-cancel" data-i18n="cancelBatch" hidden>Cancel</button>
                    <button type="button" class="btn btn-sm" id="btn-nodes-refresh" data-i18n="refreshNodeStatus">Refresh node status</button>
                  </div>
                  <div class="table-wrap"><table class="nodes">
                    <thead><tr>
                      <th data-i18n="colName">Name</th><th data-i18n="colType">Type</th>
                      <th data-i18n="colAddress">Address</th><th data-i18n="colSource">Source</th>
                      <th data-i18n="colRoute">Route</th><th data-i18n="colConnectivity">Exit connectivity</th>
                      <th data-i18n="colZenAccess">Zen access</th><th data-i18n="colLatency">Latency</th>
                      <th data-i18n="colWorker">Assigned Worker</th><th data-i18n="colActions">Actions</th>
                    </tr></thead>
                    <tbody id="nodes-body"></tbody>
                  </table></div>
                  <div class="table-foot"><div class="sum" id="nodes-sum"></div><div class="pager" id="nodes-pager"></div></div>
                </div>
              </div>
`;
