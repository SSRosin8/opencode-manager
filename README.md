# opencode-manager

**English** | [简体中文](README.zh-CN.md)

Standalone **OpenCode free-worker** LLM gateway: an OpenAI-compatible gateway for free models through anonymous Zen egresses and signed-in Zen keys.

This project provides local Clash Controller node import, per-worker egress binding, public-IP verification, faster batch probing, and real worker connection tests.

- Accepts **OpenAI-compatible** client requests (`/v1/chat/completions`, `/v1/responses`, `/v1/models`)
- **Transparent passthrough** to `https://opencode.ai/zen/v1` (configurable)
- **Free-only models**: refreshes the official Zen model catalog and serves ONLY free models (list + chat + responses); paid models are never exposed
- Separate anonymous Zen (`Bearer public`) and signed-in Zen pools, with configurable anonymous-first, signed-in-first, or mixed routing
- Per-worker enable/disable controls keep a Worker configured without sending it traffic
- Per-OpenCode-session worker affinity with failover on 429, invalid keys, and temporary upstream errors
- Optional **OpenCode CLI identity header** synthesis (Cloudflare / VPS)
- Minimal free-model body fixes (strip `client_metadata`, thinking-model `reasoning_content`, effort aliases)
- **Management page** at `/` for keys, base URL, proxies, and status

## Quick start

Prerequisites: Node.js **20.18.1 or newer** and npm. Mihomo/Clash Meta with its Controller enabled is also required when using Clash protocol nodes.

```bash
git clone https://github.com/SSRosin8/opencode-manager.git
cd opencode-manager
npm ci
npm run build
npm start
# or: npm run dev
```

`npm start` runs in the foreground of the current terminal; closing the terminal stops it, and `Ctrl+C` shuts it down. It runs the built `dist/` output, so rebuild after source changes. `npm run dev` runs the source directly for development.

The service listens on `127.0.0.1:9876` by default. For first-time setup, Clash/Mihomo configuration, OpenCode integration, verification, backups, and troubleshooting, see:

> **[Local usage guide](docs/USAGE.md)**

Development boundaries and module ownership are defined in [AGENTS.md](AGENTS.md) and [the architecture guide](docs/ARCHITECTURE.zh-CN.md). `npm run validate` enforces the structure limit, strict types, build, and tests.

- Admin UI: http://127.0.0.1:9876/
- Chat: `POST http://127.0.0.1:9876/v1/chat/completions`
- Responses: `POST http://127.0.0.1:9876/v1/responses`
- Models: `GET http://127.0.0.1:9876/v1/models`

## Configuration

| Source | Purpose |
|--------|---------|
| Admin UI | Base URL, workers (API keys), proxy pool bindings, CLI header synthesis |
| `data/settings.json` | Persisted settings (auto-created) |
| `PORT` | Listen port |
| `OPENCODE_MANAGER_HOST` | Bind address, defaults to `127.0.0.1`; use `0.0.0.0` only behind protected admin access |
| `OPENCODE_MANAGER_SETTINGS_PATH` | Custom settings file path |
| `OPENCODE_MANAGER_STATS_PATH` | Custom Worker statistics file path |
| `OPENCODE_MANAGER_MODELS_URL` | Override the official Zen model catalog URL used to refresh free models |
| `OPENCODE_SYNTHESIZE_CLI_HEADERS` | `true` to synthesize CLI identity headers (also configurable in Admin) |
| `OPENCODE_USER_AGENT` / `OPENCODE_CLIENT` / `OPENCODE_PROJECT` | Default values for synthesized CLI identity headers |

The project does not load `.env` automatically. Export variables in the shell or start with `node --env-file=.env dist/index.js`. A port changed in Admin takes effect after restart.

> Security: the relay token protects model relay endpoints only, not the Admin UI. Admin APIs can return Zen keys, proxy passwords, and subscription URLs. Never expose the admin port directly to the public Internet or an untrusted LAN.

### Native OpenCode setup

No OpenCode source changes are needed. Override the built-in `opencode` provider in `opencode.json`. When relay authentication is enabled, pass it as a custom header rather than a Zen API key:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode": {
      "options": {
        "baseURL": "http://127.0.0.1:9876/v1",
        "headers": {
          "X-OC-Relay-Key": "your-relay-token"
        }
      }
    }
  }
}
```

An empty relay token preserves the existing open-access behavior. OpenCode Go is not handled by this release.

## Free-only model serving

This gateway serves **only free models** — paid models are never exposed to clients.

- On boot it reads the official OpenCode Zen model catalog (`https://opencode.ai/zen/v1/models`) and keeps `*-free` model ids plus the explicit official special-free allowlist.
- `GET /v1/models` returns only those free models (upstream's paid entries are dropped).
- `POST /v1/chat/completions` and `POST /v1/responses` reject any request for a non-free model with `403 model_not_allowed` **before** any upstream call.
- The refreshed set is cached to `data/free-models.json`. If a refresh fails, the last successful set is kept; before the first successful refresh a static baseline of the currently-known free ids is used.

Static baseline models (the runtime refreshes from the Zen catalog; use Admin/API as the authority):

```text
big-pickle  deepseek-v4-flash-free  mimo-v2.5-free  laguna-s-2.1-free
ling-3.0-flash-free  longcat-2.0-free  north-mini-code-free  nemotron-3-ultra-free
```

## Proxy pool (IP isolation for OpenCode free)

OpenCode free accounts are often **IP-limited**. Bind each worker to a different pool proxy:

Choose one import path based on the source; these are not sequential requirements:

1. **Existing HTTP/SOCKS5 endpoint** — add it manually in Admin; no Clash bridge is required.
2. **Standard subscription URL** — add the URL and click **Fetch**.
   - Tries multiple User-Agents (`clash` first, including `0dcloud`). Some providers return full YAML only for a specific client UA; other UAs may return base64 `vless://` lists or be rejected.
   - Imports `http`/`socks` (direct) **and** `vless`/`hysteria2`/`tuic`/… (via Clash bridge)
3. **Nodes already loaded in Clash/0dcloud** — configure the bridge and click **Import Controller Nodes** to read Mihomo's current runtime Selector; the gateway does not need to download the subscription again.
4. **VLESS/Hysteria2/TUIC and similar nodes** — require a Clash bridge:
   - Run Mihomo/Clash Meta on the same machine as opencode-manager
   - Enable bridge in Admin: controller `http://127.0.0.1:9090`, mixed-port (often `7892`), selector group `主代理`
   - Gateway switches the select-group per worker, then exits via local HTTP proxy
5. **Bind** — each Worker selects a pool node via `proxyId`

A subscription fetch and a Controller import are different data views. A fetch parses the current HTTP response's top-level `proxies` or share links. A Controller import reads a runtime Selector after Mihomo has loaded caches and expanded providers. Their node counts may differ even when they appear to originate from the same subscription.

The bridge has two independent paths: Controller URL/secret is the **control plane** used to inspect and switch nodes; local host/mixed-port is the **data plane** carrying relay traffic. `127.0.0.1` always means the machine running opencode-manager, not the machine whose browser opened Admin.

Probe candidate nodes after importing. A probe records and persists the public egress IP, then sends a real anonymous Zen free-model request with `Bearer public`; after a restart the UI keeps showing the last successful egress, and a failed probe does not erase it. Only successful egress routes are eligible for automatic assignment. Nodes are deduplicated by public IP, and one egress may host at most one anonymous worker plus one signed-in worker. A single mixed-port uses one shared selector; the gateway serializes node selection and connection setup. Do not switch that selector from another client while the gateway is running. Use separate Mihomo inbounds or instances when workers must permanently own concurrent ports.

Testing an individual node verifies its public IP and anonymous Zen access, then immediately adds a missing anonymous Worker. **Batch Test** first screens nodes through Mihomo's delay API, then verifies every distinct public IP against anonymous Zen. Each verified unique egress is automatically added as an anonymous Worker; you only need to add signed-in Zen accounts manually. Re-running individual or batch tests only adds missing Workers and never duplicates or removes existing ones. Direct checks run with up to eight-way concurrency; Clash checks reuse one selector switch for the public-IP and Zen requests. A single shared Clash selector still processes different nodes serially to prevent route mix-ups.

The Worker page controls routing strategy and whether each Worker receives traffic. The default `Anonymous first` strategy exhausts all usable anonymous Workers before signed-in keys. `Signed-in first` reverses that preference, while `Mixed` follows the configured Worker order. Connection probes use a one-token input and `max_tokens: 1` to minimize free-quota consumption. After saving a signed-in Worker, click **Test connection** on its card to verify the exact key and route. Results include HTTP status, total latency, node, and public egress IP.

The Overview separates client generation requests, per-Worker upstream attempts, and `/v1/models` attempts; a retry chain counts as one client generation request while Worker rows retain the actual routing attempts. The global model distribution is deduplicated by client request chain, while each Worker shows the models it actually attempted. Tokens include only `usage` reported by successful upstream responses, with usage coverage shown in the details. Cache hit rate is cache-read input tokens divided by total input tokens; cache misses and explicit cache writes remain separate. Token and cache totals are also grouped by model so model changes can be inspected independently. Failures before upstream routing appear in a separate Gateway rejections list. The global **Reset stats** action clears Worker counters, upstream attempts, recent errors, and gateway rejections together.

Workers may be saved as an empty list. In that state relay requests return a clear `503` until Workers are added manually or recreated by Batch Test. Dense Worker, IP-isolation, proxy-node, upstream-attempt, and gateway-rejection lists use eight-item pages. The desktop sidebar and long status sections can be collapsed, and the browser remembers those display preferences; mobile keeps the compact horizontal navigation.

## Tests

```bash
npm test
```

## License

MIT

## Acknowledgements

- Original project: [kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay)
- Original copyright notice: Copyright (c) 2026 OCFreeRelay contributors.
- Thanks to the original author and contributors for the initial implementation.

## Community

- [Linux.do](https://linux.do) — open-source & developer community
