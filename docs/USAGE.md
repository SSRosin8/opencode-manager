# Local Usage Guide

This guide covers local startup, proxy import, anonymous and signed-in Zen Workers, OpenCode integration, validation, backups, and troubleshooting. This release supports Zen only, not OpenCode Go, and serves only runtime-approved free models.

## 1. Install And Start

Node.js 20.18.1 or newer is required:

```bash
node --version
git clone https://github.com/SSRosin8/opencode-manager.git
cd opencode-manager
npm ci
npm start
```

Open http://127.0.0.1:9876/ or check:

```bash
curl http://127.0.0.1:9876/health
```

`npm start` builds the source, starts the service in the background, waits for health, and prints the Admin URL. Use `npm run status`, `npm run restart`, and `npm stop` for routine operation. Runtime metadata and logs are stored under the ignored `data/run/` directory. For foreground operation use `npm run build && npm run foreground`; use `npm run dev` during development.

The service commands are idempotent and stop with `SIGTERM`. To inspect the listener directly:

```bash
ss -ltnp | grep ':9876'
# macOS: lsof -nP -iTCP:9876 -sTCP:LISTEN
```

An Admin port change requires a restart. The project does not load `.env` automatically; use shell variables, for example `PORT=9988 npm start`.

The default bind address is `127.0.0.1`. Set `OPENCODE_MANAGER_HOST=0.0.0.0` only when Admin is separately protected by a firewall or reverse proxy.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `PORT` | Override the Admin and gateway listen port |
| `OPENCODE_MANAGER_HOST` | Bind address; defaults to `127.0.0.1` |
| `OPENCODE_MANAGER_SETTINGS_PATH` | Override the settings file path |
| `OPENCODE_MANAGER_STATS_PATH` | Override the Worker statistics file path |
| `OPENCODE_MANAGER_MODELS_URL` | Override the official Zen model catalog URL |
| `OPENCODE_MANAGER_ANONYMOUS_ZEN_TIMEOUT_MS` | Anonymous Zen probe timeout in milliseconds, bounded to 5,000-120,000 |
| `OPENCODE_SYNTHESIZE_CLI_HEADERS` | Enable OpenCode CLI identity-header synthesis |
| `OPENCODE_USER_AGENT` / `OPENCODE_CLIENT` / `OPENCODE_PROJECT` | Defaults for synthesized CLI identity headers |
| `OPENCODE_MANAGER_SERVICE_RUNTIME_DIR` | Override the service PID/log directory used by `npm start` and related commands |
| `OPENCODE_MANAGER_SERVICE_ENTRY` | Override the built entry path used by the service script; advanced operation only |

## 2. Security Boundary

- `X-OC-Relay-Key` protects `/v1/*` and the compatibility aliases `/models`, `/chat/completions`, and `/responses` only.
- `/health` is intentionally unauthenticated and returns only process health, not settings or credentials.
- `/` and `/admin/api/*` are not protected by that token.
- Admin APIs contain Zen keys, proxy passwords, Clash secrets, and tokenized subscription URLs.
- Never expose port 9876 directly to the public Internet or an untrusted LAN.
- `data/settings.json` contains credentials and must never be committed or shared.

For remote clients, publish `/v1/*` only and block `/`, `/admin`, and `/admin/api/*` at the reverse proxy.

## 3. First-Run Workflow And Navigation

The Overview presents the recommended five-step path: configure the gateway, add a node source, test nodes, bind Workers, and connect OpenCode. Each step opens the relevant page. Dismiss the card after setup; the question-mark button in the top bar reopens the guide at any time.

The desktop navigation reflects how the service is operated:

- **Overview**: service health, request results, usage, routing attempts, and gateway rejections.
- **Resources**: Gateway, Proxy Pool, Workers, and Models. These pages define the relay, available egresses, routing identities, and the detected official free-model set.
- **Client access**: Client Usage, including the OpenAI-compatible base URL and supported endpoints.

The two group headings collapse their own entries and remember that choice in the browser. The button at the bottom collapses the whole sidebar. On mobile, navigation is kept flat so that a collapsed group cannot hide a destination.

### Initial Gateway Settings

Open **Resources → Gateway**. The request-path summary shows that proxy exits are configured later in Proxy Pool and Workers; the Gateway page itself does not select an IP.

1. Keep Base URL at `https://opencode.ai/zen/v1`.
2. Set a relay access token and send it as `X-OC-Relay-Key` from clients.
3. Keep the listen port at `9876` unless it conflicts with another service. A port change takes effect after restart.
4. Leave **Advanced compatibility** collapsed and CLI identity synthesis off unless required by a VPS, Cloudflare, or non-standard client deployment.
5. Save changes.

## 4. Prepare Clash/Mihomo

Choose a path based on the proxy source you already have:

| Available source | Recommended path | Clash bridge required |
|---|---|---|
| HTTP/SOCKS5 endpoint | Add it manually | No |
| Standard subscription URL | Add the subscription and click Fetch | Not for HTTP/SOCKS; required for protocol nodes |
| Nodes already loaded in Clash/0dcloud | Configure the bridge and Import Controller Nodes | Yes |
| Controller secret is unavailable | Use an independent Mihomo instance you control, or use HTTP/SOCKS only | Depends on the chosen path |

Subscription pulls negotiate several client User-Agents, including `clash`, `0dcloud`, and Clash Verge Rev, because some providers return `504` or different content unless the exact client identity is used. The parser accepts Clash YAML/JSON, SIP008 JSON, common VMess/SS/SSR and other share links, and up to three Base64 wrapping layers. It parses only the **current HTTP response's** top-level nodes; it does not read a Clash client's cache or expand remote `proxy-providers` in that response.

Import Controller Nodes reads leaf nodes already loaded into Mihomo's runtime Selector. Mihomo may have used cache, expanded providers, or merged other sources. Direct-fetch and Controller-import counts therefore need not match even when the subscription URL appears to be the same.

HTTP and SOCKS5 proxies work directly. VLESS, Hysteria2, TUIC, AnyTLS, and similar nodes require local Mihomo/Clash Meta:

1. Load nodes and enable External Controller, commonly `http://127.0.0.1:9090`.
2. Identify the local mixed-port, such as `7890`.
3. Identify the Selector group that owns the leaf nodes, such as `Proxy`.
4. In Proxy Pool, configure Controller URL, secret, host, port, and Selector group; enable and save the bridge.
5. Test the bridge, then click Import Controller Nodes.

The bridge has two independent paths:

- **Control plane**: Controller URL and secret, used to enumerate nodes, query delay, and switch the Selector; commonly port `9090`.
- **Data plane**: local host and mixed-port, used to carry actual HTTP traffic; commonly `7890`, `7892`, or the port reported by the client.

Both must work. A successful Controller test does not prove the mixed-port can relay traffic. `127.0.0.1` in these fields means the machine running opencode-manager. It cannot address Clash on another machine, and an unauthenticated Controller must not be exposed to a LAN.

Do not switch the same Selector from another client while probing or relaying traffic.

`Proxy` and `GLOBAL` are selector/routing groups, not separate node pools or separate quotas. `GLOBAL` normally controls Clash global mode, while custom groups such as `Proxy` usually receive rule-mode traffic. Choose the group used by the active mode and make sure it can directly select leaf nodes. In common configurations, `GLOBAL` contains only upper-level policies such as `Proxy` and `DIRECT`; such a group cannot be imported as a leaf-node group. Node identity is based on the Controller address and exact leaf name, so importing the same nodes through `Proxy` and `GLOBAL` no longer creates duplicates. Re-importing after changing the selector on the same Controller replaces the current view and migrates bindings for nodes that still exist; changing the Controller address clears the old egress state and requires rebinding and retesting.

## 5. Create Anonymous Zen Workers

After importing nodes, test an individual node or click Batch Test. A successful individual test also reads the public egress IP, sends the minimal anonymous Zen request, and immediately creates the corresponding anonymous Worker. Repeating the test does not create a duplicate.

Batch Test has two phases:

- Screening calls Mihomo's delay API concurrently.
- Verification switches each node, reads its public IP, and sends one minimal anonymous Zen request.

A shared Selector must verify nodes serially to avoid route mix-ups. Every newly usable, unique egress is immediately saved as an anonymous Worker. During the batch, the UI updates progress, completed nodes, health totals, and Worker metrics in place without rebuilding the metric cards; the Workers list and IP Isolation refresh once after the batch finishes. Pause lets active node checks finish and then stops scheduling more work; Resume continues. Cancel aborts in-flight network requests, drops pending nodes, and keeps completed results and Workers already created. Duplicate egress IPs create only one anonymous Worker; proxy nodes themselves remain in the pool.

Probe results and the last batch summary are persisted under `data/probe-state.json`, so restarting the service does not erase health, latency, or egress information. A batch that was active during shutdown is restored as interrupted (completed results are kept); start a new test to verify remaining nodes.

Anonymous Zen verification uses a 45-second timeout by default instead of the shorter network-egress timeout. Adjust `OPENCODE_MANAGER_ANONYMOUS_ZEN_TIMEOUT_MS` for slower routes; values are bounded to 5,000-120,000 ms. Result details distinguish timeouts, rate limits, access denials, and upstream HTTP errors.

**Remove all** clears the entire proxy pool and all cached probe results, and unbinds Workers from their proxies. It keeps the Workers, subscriptions, and Clash bridge settings so nodes can be imported again later. This action is unavailable while a batch test is running.

## 6. Add Signed-In Zen Workers

On Workers:

1. Click **Add signed-in Worker**.
2. Enter a unique ID and Zen API key.
3. Bind a verified proxy node and save.
4. Click Test connection.

Each Worker card can select a test model from the current detected free-model set. Anonymous Workers always use `Bearer public`, so they do not show an API key field. A signed-in Worker checks public egress and then uses its key with the selected model; testing is rejected before any network probe when the key is empty. Disable a Worker to retain its configuration without routing traffic to it.

When the batch test's primary model returns the same upstream `503` on two consecutive distinct egresses (in verification completion order), the second failed egress is cross-checked once with another official free model. A successful fallback identifies a primary-model availability issue; the same `503` identifies a provider route unavailable for that egress. The batch adds at most one cross-check request and continues testing all nodes.

**Repair signed-in bindings** preserves every reachable, non-conflicting signed-in binding and only fills Workers that are unbound, deleted, disabled, unreachable, or share an egress with another signed-in Worker. It never changes anonymous Workers. One egress may intentionally host one anonymous Worker and one signed-in Worker.

## 7. Routing Strategies

- Anonymous first: exhaust usable anonymous Workers before signed-in Zen.
- Signed-in first: reverse that preference.
- Mixed: follow configured Worker order.

OpenCode sessions remain sticky to a Worker for cache locality. The gateway rotates after 401, 403, 429, 5xx, or transport failures.

The Overview distinguishes client generation requests from actual per-Worker upstream attempts. A retry chain counts as one client request, while every routed attempt remains visible on its Worker; only 2xx final responses count as successful. Global model distribution is deduplicated by request chain, while each Worker shows its actual attempted models. Tokens are accumulated only when a successful upstream response reports `usage`. Streaming requests ask the upstream to include usage, but missing usage is still shown in the coverage details instead of being estimated. Cache hit rate is cache-read input tokens divided by total input tokens; uncached input and explicit cache writes are separate values. Token and cache totals are grouped by model so model changes can be inspected independently. Failures before routing appear under Gateway rejections. Global **Reset stats** clears Worker counters, recent upstream attempts, recent errors, and Gateway rejections.

## 8. Connect OpenCode

Create or edit project/global `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode": {
      "options": {
        "baseURL": "http://127.0.0.1:9876/v1",
        "headers": {
          "X-OC-Relay-Key": "replace-with-relay-token"
        }
      }
    }
  }
}
```

Remove `headers` when no relay token is configured. Reload provider configuration or restart OpenCode after editing. Prefixed model names such as `opencode/big-pickle` are normalized by the gateway.

## 9. Verify Independently

```bash
export RELAY_KEY='replace-with-relay-token'

curl -sS http://127.0.0.1:9876/v1/models \
  -H "X-OC-Relay-Key: $RELAY_KEY"

curl -sS http://127.0.0.1:9876/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "X-OC-Relay-Key: $RELAY_KEY" \
  -d '{"model":"big-pickle","messages":[{"role":"user","content":"hi"}],"max_tokens":8}'

curl -sS http://127.0.0.1:9876/v1/responses \
  -H 'Content-Type: application/json' \
  -H "X-OC-Relay-Key: $RELAY_KEY" \
  -d '{"model":"big-pickle","input":"hi","max_output_tokens":8}'
```

Remove the token header when relay authentication is disabled. Chat Completions and Responses use the same authentication, free-model enforcement, Worker routing, proxy, retry, and statistics path. Paid or unknown models return `403 model_not_allowed` before upstream access.

## 10. Shortest Layered Validation

Validate in this order and investigate only the first failing layer:

1. **Process**: `curl http://127.0.0.1:9876/health` returns `ok: true`.
2. **Proxy source**: the subscription reports a plausible node count, or Controller import succeeds with the intended Selector.
3. **Clash control plane**: Test Connection succeeds and discovers the target Selector.
4. **Clash data plane**: test one node and confirm a public egress IP before starting a batch.
5. **Worker**: at least one Worker is enabled, ready, and bound to the expected proxy.
6. **Models**: `/v1/models` confirms relay authentication and the free-model list.
7. **Generation**: send one minimal `/v1/chat/completions` or `/v1/responses` request last.

Skip step 3 when Clash is not used. HTTP/SOCKS proxies still need the real-egress check in step 4.

## 11. Data, Backup, And Upgrade

- `data/settings.json`: Workers, keys, proxies, subscriptions, Admin settings, and each proxy's last successful public egress IP; sensitive. A failed probe does not erase the last successful egress, while **Remove all** removes it with the proxy pool.
- `data/probe-state.json`: sanitized proxy probe results and the latest batch state.
- `data/worker-stats.json`: usage and attempt statistics.
- `data/free-models.json`: rebuildable free-model cache.

Older `worker-stats.json` files remain readable. Historical totals created before usage coverage and per-model token tracking do not gain those details retroactively; only new responses add them. A legacy cache value that represented uncached input is migrated to cache misses rather than being reported as an explicit cache write.

`OPENCODE_MANAGER_SETTINGS_PATH` overrides `settings.json`; `probe-state.json` and `free-models.json` follow it into the same directory. `OPENCODE_MANAGER_STATS_PATH` independently overrides `worker-stats.json`. Stop the service before copying the resulting data files for backup or migration.

Stop the running service before upgrading so old and new builds do not compete for the same port:

```bash
npm stop
git pull --ff-only
npm ci
npm run build
npm test
npm start
```

## 12. Troubleshooting

- Long batch: distinguish Screening from Verification. Shared Clash verification is intentionally serial and dead nodes wait for timeouts. Refreshing the page restores progress display; a service restart marks an active batch interrupted and keeps completed results.
- `503 no_workers_configured`: run Batch Test or add a signed-in Worker.
- `503 no_enabled_workers`: enable and save at least one Worker.
- Worker test failure: distinguish egress failure, 401/403 invalid key, 429 exhausted quota, and temporary 5xx.
- Port conflict: run `PORT=9988 npm start`; Admin port changes apply after restart.

### Controller And Bridge

| Symptom | Meaning and checks |
|---|---|
| Connection refused or timeout | Wrong Controller address/port, or Mihomo is not listening |
| `401 Unauthorized` | Controller is reachable, but the secret is missing or wrong; some clients do not expose their internal secret |
| `404` | The target is usually not a Clash Controller port or endpoint |
| `selector group not found` | Selector name is wrong; use a Selector reported by Test Connection |
| Controller succeeds, node test fails | Check mixed-port, active routing mode, whether the Selector carries traffic, and data-plane egress |

### Subscription Fetch

| Symptom | Meaning and checks |
|---|---|
| `403` | Provider rejected the User-Agent, source IP, or subscription authorization |
| `504` | The subscription gateway could not reach its upstream in time; this is not a parser error in this project |
| Fetch succeeds with too few nodes | The current response may be a different-UA format, a single-node response, or a provider config; it is not the same as Clash's expanded runtime cache |
| Controller has more nodes than fetch | Controller exposes Mihomo's final in-memory Selector, possibly including cache, expanded providers, or other sources |

Subscription URLs normally contain access tokens. Do not publish complete URLs, response bodies, or secrets while troubleshooting.

## 13. Current Limits

- Zen only; OpenCode Go is unsupported.
- One shared Clash Selector cannot safely sustain simultaneous distinct egresses. Use independent Mihomo inbounds or instances for true concurrency.
- Normal upstream relay requests do not yet have a unified request timeout; a severely stalled upstream can wait for an extended period.
- Admin has no separate authentication and must be protected by local binding, network isolation, or a reverse proxy.
- The official free-model catalog refreshes on startup and every 15 minutes; Admin can request an immediate refresh. A validated last-success cache is used when the catalog is temporarily unavailable.
