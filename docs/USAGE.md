# Local Usage Guide

This guide covers local startup, proxy import, anonymous and signed-in Zen Workers, OpenCode integration, validation, backups, and troubleshooting. This release supports Zen only, not OpenCode Go, and serves only runtime-approved free models.

## 1. Install And Start

Node.js 20.18.1 or newer is required:

```bash
node --version
git clone https://github.com/SSRosin8/opencode-manager.git
cd opencode-manager
npm ci
npm run build
npm start
```

Open http://127.0.0.1:9876/ or check:

```bash
curl http://127.0.0.1:9876/health
```

Use `npm run dev` for development without a prior build. An Admin port change requires a restart. The project does not load `.env` automatically; use shell variables, for example `PORT=9988 npm start`.

The default bind address is `127.0.0.1`. Set `OCFREERELAY_HOST=0.0.0.0` only when Admin is separately protected by a firewall or reverse proxy.

## 2. Security Boundary

- `X-OC-Relay-Key` protects `/v1/*`, `/models`, and `/chat/completions` only.
- `/` and `/admin/api/*` are not protected by that token.
- Admin APIs contain Zen keys, proxy passwords, Clash secrets, and tokenized subscription URLs.
- Never expose port 9876 directly to the public Internet or an untrusted LAN.
- `data/settings.json` contains credentials and must never be committed or shared.

For remote clients, publish `/v1/*` only and block `/`, `/admin`, and `/admin/api/*` at the reverse proxy.

## 3. Initial Gateway Settings

On the Gateway page:

1. Keep Base URL at `https://opencode.ai/zen/v1`.
2. Set a relay access token and send it as `X-OC-Relay-Key` from clients.
3. Leave CLI identity synthesis off unless required by a VPS or Cloudflare deployment.
4. Save changes.

## 4. Prepare Clash/Mihomo

HTTP and SOCKS5 proxies work directly. VLESS, Hysteria2, TUIC, AnyTLS, and similar nodes require local Mihomo/Clash Meta:

1. Load nodes and enable External Controller, commonly `http://127.0.0.1:9090`.
2. Identify the local mixed-port, such as `7890`.
3. Identify the Selector group that owns the leaf nodes, such as `Proxy`.
4. In Proxy Pool, configure Controller URL, secret, host, port, and Selector group; enable and save the bridge.
5. Test the bridge, then click Import Controller Nodes.

Do not switch the same Selector from another client while probing or relaying traffic.

## 5. Create Anonymous Zen Workers

After importing nodes, click Batch Test. It has two phases:

- Screening calls Mihomo's delay API concurrently.
- Verification switches each node, reads its public IP, and sends one minimal anonymous Zen request.

A shared Selector must verify nodes serially to avoid route mix-ups. Every newly usable, unique egress is immediately saved as an anonymous Worker and appears in Workers and IP Isolation before the entire batch finishes. Duplicate egress IPs create only one anonymous Worker; proxy nodes themselves remain in the pool.

## 6. Add Signed-In Zen Workers

On Workers:

1. Click **Add signed-in Worker**.
2. Enter a unique ID and Zen API key.
3. Bind a verified proxy node and save.
4. Click Test connection.

The test checks public egress and then uses that signed-in key directly; it does not consume anonymous Zen quota first. Disable a Worker to retain its configuration without routing traffic to it.

## 7. Routing Strategies

- Anonymous first: exhaust usable anonymous Workers before signed-in Zen.
- Signed-in first: reverse that preference.
- Mixed: follow configured Worker order.

OpenCode sessions remain sticky to a Worker for cache locality. The gateway rotates after 401, 403, 429, 5xx, or transport failures.

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
```

Remove the token header when relay authentication is disabled. Paid or unknown models return `403 model_not_allowed` before upstream access.

## 10. Data, Backup, And Upgrade

- `data/settings.json`: Workers, keys, proxies, subscriptions, and Admin settings; sensitive.
- `data/worker-stats.json`: usage and attempt statistics.
- `data/free-models.json`: rebuildable free-model cache.

Override paths with `OCFREERELAY_SETTINGS_PATH` and `OCFREERELAY_STATS_PATH`. Stop the service before copying `data/` for backup or migration.

```bash
git pull --ff-only
npm ci
npm run build
npm test
npm start
```

## 11. Troubleshooting

- Long batch: distinguish Screening from Verification. Shared Clash verification is intentionally serial and dead nodes wait for timeouts.
- `503 no_workers_configured`: run Batch Test or add a signed-in Worker.
- `503 no_enabled_workers`: enable and save at least one Worker.
- Worker test failure: distinguish egress failure, 401/403 invalid key, 429 exhausted quota, and temporary 5xx.
- Controller failure: verify URL, secret, mixed-port, Selector name, and leaf nodes.
- Port conflict: run `PORT=9988 npm start`; Admin port changes apply after restart.

## 12. Current Limits

- Zen only; OpenCode Go is unsupported.
- One shared Clash Selector cannot safely sustain simultaneous distinct egresses. Use independent Mihomo inbounds or instances for true concurrency.
- Normal upstream relay requests do not yet have a unified request timeout; a severely stalled upstream can wait for an extended period.
- Admin has no separate authentication and must be protected by local binding, network isolation, or a reverse proxy.
