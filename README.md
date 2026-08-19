# OCFreeRelay

**English** | [简体中文](README.zh-CN.md)

Standalone **OpenCode free-worker** LLM gateway: an OpenAI-compatible relay that serves OpenCode's free models through your own API keys.

> This repository is derived from [kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay), with attribution retained here. It extends the original project with local Clash Controller node import, per-worker egress binding, public-IP verification, faster batch probing, and real worker connection tests.

- Accepts **OpenAI-compatible** client requests (`/v1/chat/completions`, `/v1/models`)
- **Transparent passthrough** to `https://opencode.ai/zen/v1` (configurable)
- **Free-only models**: auto-scrapes the Zen pricing page and serves ONLY free models (list + chat); paid models are never exposed
- Multi-key / multi-account **sticky affinity until 429**, then rotate + cooldown (keeps prompt cache warm)
- Optional **OpenCode CLI identity header** synthesis (Cloudflare / VPS)
- Minimal free-model body fixes (strip `client_metadata`, thinking-model `reasoning_content`, effort aliases)
- **Management page** at `/` for keys, base URL, proxies, and status

## Quick start

```bash
npm install
npm run build
npm start
# or: npm run dev
```

Default port: **9876** (override with `PORT` or admin settings).

- Admin UI: http://127.0.0.1:9876/
- Chat: `POST http://127.0.0.1:9876/v1/chat/completions`
- Models: `GET http://127.0.0.1:9876/v1/models`

## Configuration

| Source | Purpose |
|--------|---------|
| Admin UI | Base URL, workers (API keys), proxy pool bindings, CLI header synthesis |
| `data/settings.json` | Persisted settings (auto-created) |
| `PORT` | Listen port |
| `OCFREERELAY_SETTINGS_PATH` | Custom settings file path |
| `OPENCODE_SYNTHESIZE_CLI_HEADERS` | `true` to synthesize CLI identity headers (also toggleable in admin) |
| `OPENCODE_USER_AGENT` / `OPENCODE_CLIENT` / `OPENCODE_PROJECT` | CLI default values |
| `OCFREERELAY_PRICING_URL` | Override the Zen pricing page URL used to scrape free models |

## Free-only model serving

This gateway serves **only free models** — paid models are never exposed to clients.

- On boot it scrapes the OpenCode Zen pricing page (`https://opencode.ai/docs/zen`) and keeps every model whose Input & Output price is `Free`.
- `GET /v1/models` returns only those free models (upstream's paid entries are dropped).
- `POST /v1/chat/completions` rejects any request for a non-free model with `403 model_not_allowed` **before** any upstream call.
- The scraped set is cached to `data/free-models.json`. If a scrape fails, the last successful set is kept; before the first successful scrape a static baseline of the currently-known free ids is used.

Current free models:

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

Probe candidate nodes after importing. Probes record the public egress IP, and automatic assignment avoids nodes with the same known egress IP. A single mixed-port uses one shared selector; the gateway serializes node selection and connection setup. Do not switch that selector from another client while the gateway is running. Use separate Mihomo inbounds or instances when workers must permanently own concurrent ports.

**Batch Test** screens nodes concurrently through Mihomo's delay API and prioritizes public-IP verification for currently bound workers. After saving a worker, click **Test connection** on its card to send a real OpenCode request with that exact key and bound node; the result includes HTTP status, total latency, node, and public egress IP.

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
