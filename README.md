# OCFreeRelay

**English** | [简体中文](README.zh-CN.md)

Standalone **OpenCode free-worker** LLM gateway: an OpenAI-compatible gateway for free models through anonymous Zen egresses and signed-in Zen keys.

> This repository is derived from [kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay), with attribution retained here. It extends the original project with local Clash Controller node import, per-worker egress binding, public-IP verification, faster batch probing, and real worker connection tests.

- Accepts **OpenAI-compatible** client requests (`/v1/chat/completions`, `/v1/models`)
- **Transparent passthrough** to `https://opencode.ai/zen/v1` (configurable)
- **Free-only models**: auto-scrapes the Zen pricing page and serves ONLY free models (list + chat); paid models are never exposed
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

The service listens on `127.0.0.1:9876` by default. For first-time setup, Clash/Mihomo configuration, OpenCode integration, verification, backups, and troubleshooting, see:

> **[Local usage guide](docs/USAGE.md)**

- Admin UI: http://127.0.0.1:9876/
- Chat: `POST http://127.0.0.1:9876/v1/chat/completions`
- Models: `GET http://127.0.0.1:9876/v1/models`

## Configuration

| Source | Purpose |
|--------|---------|
| Admin UI | Base URL, workers (API keys), proxy pool bindings, CLI header synthesis |
| `data/settings.json` | Persisted settings (auto-created) |
| `PORT` | Listen port |
| `OCFREERELAY_HOST` | Bind address, defaults to `127.0.0.1`; use `0.0.0.0` only behind protected admin access |
| `OCFREERELAY_SETTINGS_PATH` | Custom settings file path |
| `OCFREERELAY_STATS_PATH` | Custom Worker statistics file path |
| `OCFREERELAY_PRICING_URL` | Override the Zen pricing page URL used to scrape free models |
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

- On boot it scrapes the OpenCode Zen pricing page (`https://opencode.ai/docs/zen`) and keeps every model whose Input & Output price is `Free`.
- `GET /v1/models` returns only those free models (upstream's paid entries are dropped).
- `POST /v1/chat/completions` rejects any request for a non-free model with `403 model_not_allowed` **before** any upstream call.
- The scraped set is cached to `data/free-models.json`. If a scrape fails, the last successful set is kept; before the first successful scrape a static baseline of the currently-known free ids is used.

Static baseline models (the runtime refreshes from Zen pricing; use Admin/API as the authority):

```text
big-pickle  deepseek-v4-flash-free  mimo-v2.5-free  laguna-s-2.1-free
ling-3.0-flash-free  longcat-2.0-free  north-mini-code-free  nemotron-3-ultra-free
```

## Proxy pool (IP isolation for OpenCode free)

OpenCode free accounts are often **IP-limited**. Bind each worker to a different pool proxy:

1. **Manual** — Admin → Proxy pool → add HTTP/SOCKS5 host:port
2. **Clash subscription** — add subscription URL → **拉取** (fetch)
   - Tries multiple User-Agents (`clash` first). Some providers return full YAML only for the `clash` UA; other UAs return base64 `vless://` lists.
   - Imports `http`/`socks` (direct) **and** `vless`/`hysteria2`/`tuic`/… (via Clash bridge)
3. **Clash bridge** — for protocol nodes:
   - Run Mihomo/Clash Meta locally with the **same** subscription
   - Enable bridge in Admin: controller `http://127.0.0.1:9090`, mixed-port (often `7892`), selector group `主代理`
   - For clients such as 0dcloud that already loaded nodes into Mihomo, click **Import Controller Nodes** instead of downloading the subscription again
   - Gateway switches the select-group per worker, then exits via local HTTP proxy
4. **Bind** — each Worker selects a pool node via `proxyId`

Probe candidate nodes after importing. A probe records the public egress IP and then sends a real anonymous Zen free-model request with `Bearer public`; only successful egress routes are eligible for automatic assignment. Nodes are deduplicated by public IP, and one egress may host at most one anonymous worker plus one signed-in worker. A single mixed-port uses one shared selector; the gateway serializes node selection and connection setup. Do not switch that selector from another client while the gateway is running. Use separate Mihomo inbounds or instances when workers must permanently own concurrent ports.

**Batch Test** first screens nodes through Mihomo's delay API, then verifies every distinct public IP against anonymous Zen. Each verified unique egress is automatically added as an anonymous Worker; you only need to add signed-in Zen accounts manually. Re-running or partially running the batch test only adds missing Workers and never duplicates or removes existing ones. Direct checks run with up to eight-way concurrency; Clash checks reuse one selector switch for the public-IP and Zen requests. A single shared Clash selector still processes different nodes serially to prevent route mix-ups.

The Worker page controls routing strategy and whether each Worker receives traffic. The default `Anonymous first` strategy exhausts all usable anonymous Workers before signed-in keys. `Signed-in first` reverses that preference, while `Mixed` follows the configured Worker order. Connection probes use a one-token input and `max_tokens: 1` to minimize free-quota consumption. After saving a signed-in Worker, click **Test connection** on its card to verify the exact key and route. Results include HTTP status, total latency, node, and public egress IP.

The Overview page reports actual chat model usage per Worker. `/v1/models` list requests are tracked separately from models used by chat requests.

Workers may be saved as an empty list. In that state relay requests return a clear `503` until Workers are added manually or recreated by Batch Test. Long Worker lists, status metrics, Worker usage, IP isolation, and proxy-node sections can be collapsed; the browser remembers those display preferences.

## Tests

```bash
npm test
```

## License

MIT

## Acknowledgements

- Original project: [kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay)
- Thanks to the original author and contributors for the initial implementation.

## Community

- [Linux.do](https://linux.do) — open-source & developer community
