# opencode-manager

**English** | [简体中文](README.zh-CN.md)

Local OpenAI-compatible gateway for OpenCode Zen free models. It manages anonymous and signed-in Zen Workers, verifies their proxy egresses, and routes client requests across healthy Workers.

## Highlights

- OpenAI-compatible `/v1/chat/completions`, `/v1/responses`, and `/v1/models`
- Free-model-only catalog and request enforcement
- Anonymous Zen and signed-in Zen Worker pools with configurable routing priority
- HTTP/SOCKS proxies, subscription import, and Clash/Mihomo Controller integration
- Public egress-IP verification, incremental batch tests, and automatic anonymous Workers
- Local Admin UI for Gateway, Proxy Pool, Workers, Models, client setup, and usage statistics

## Quick start

Requires Node.js 20.18.1 or newer and npm. Clash/Mihomo is required only for protocol nodes that cannot be used as direct HTTP/SOCKS proxies.

```bash
git clone https://github.com/SSRosin8/opencode-manager.git
cd opencode-manager
npm ci
npm start
```

`npm start` builds and starts the service in the background, waits for health, and prints the Admin URL. Routine commands:

```bash
npm run status
npm run restart
npm stop
```

The service listens on `127.0.0.1:9876` by default.

- Admin UI: http://127.0.0.1:9876/
- OpenAI-compatible base URL: `http://127.0.0.1:9876/v1`
- Health check: `http://127.0.0.1:9876/health`

## Documentation

- [Local usage guide](docs/USAGE.md): installation, configuration, proxy import, Workers, OpenCode integration, backup, and troubleshooting
- [中文使用指南](docs/USAGE.zh-CN.md)
- [Architecture](docs/ARCHITECTURE.zh-CN.md): module ownership, dependencies, and persistence boundaries
- [Contribution rules](AGENTS.md): repository structure, security requirements, and validation expectations

Security: the relay token protects model endpoints (constant-time compare); the Admin surface accepts loopback clients only (`403` otherwise) and `settings.json` is written atomically with `0600`. Publish `/v1/*` only, never expose the admin port publicly.

## Development

```bash
npm run dev
npm run validate
```

## License

MIT

## Acknowledgements

- Original project: [kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay)
- Original copyright notice: Copyright (c) 2026 OCFreeRelay contributors.
- Thanks to the original author and contributors for the initial implementation.
