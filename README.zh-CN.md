# opencode-manager

[English](README.md) | **简体中文**

独立的 **OpenCode 免费 Worker** LLM 网关：通过匿名 Zen 出口和登录 Zen Key 提供 OpenCode 免费模型的 OpenAI 兼容网关。

本项目提供本机 Clash Controller 节点导入、Worker 独立出口绑定、真实出口 IP 验证、快速批量测试和 Worker 真实连接测试等功能。

- 接受 **OpenAI 兼容**的客户端请求（`/v1/chat/completions`、`/v1/responses`、`/v1/models`）
- **透明转发**到 `https://opencode.ai/zen/v1`（可配置）
- **仅免费模型**：自动刷新 Zen 官方模型目录，只提供免费模型（列表 + 对话 + Responses）；付费模型永不暴露
- 匿名 Zen（自动使用 `Bearer public`）与登录 Zen Key 分池统计，可配置匿名优先、登录优先或混合调度
- 每个 Worker 可单独禁用，保留配置但不参与流量调度
- 按 OpenCode 会话粘性绑定 Worker；429、无效 Key 和临时上游故障自动切换
- 可选 **OpenCode CLI 身份请求头**合成（Cloudflare / VPS）
- 最小化的免费模型请求体修复（去除 `client_metadata`、思考模型的 `reasoning_content`、effort 别名等）
- `/` 提供**管理页面**，管理 Key、Base URL、代理和状态

## 快速开始

前置条件：Node.js **20.18.1 或更高版本**、npm。使用 Clash/Mihomo 协议节点时，还需要已开启 Controller 的 Mihomo/Clash Meta。

```bash
git clone https://github.com/SSRosin8/opencode-manager.git
cd opencode-manager
npm ci
npm run build
npm start
# 或: npm run dev
```

`npm start` 在当前终端前台运行，关闭终端会停止服务；停止时按 `Ctrl+C`。它运行的是已经构建的 `dist/`，修改源码后需重新执行 `npm run build`。`npm run dev` 直接运行源码，适合开发调试。

默认仅监听 `127.0.0.1:9876`。完整的首次配置、Clash/Mihomo、OpenCode 接入、验证、备份和故障排查步骤请阅读：

> **[本机使用指南](docs/USAGE.zh-CN.md)**

开发边界和模块职责见 [AGENTS.md](AGENTS.md) 与 [架构说明](docs/ARCHITECTURE.zh-CN.md)。`npm run validate` 会统一执行结构限制、严格类型检查、构建和测试。

- 管理后台：http://127.0.0.1:9876/
- 对话：`POST http://127.0.0.1:9876/v1/chat/completions`
- Responses：`POST http://127.0.0.1:9876/v1/responses`
- 模型列表：`GET http://127.0.0.1:9876/v1/models`

## 配置

| 来源 | 用途 |
|--------|---------|
| 管理后台 | Base URL、Worker（API Key）、代理池绑定、CLI 请求头合成 |
| `data/settings.json` | 持久化设置（自动创建） |
| `PORT` | 监听端口 |
| `OPENCODE_MANAGER_HOST` | 监听地址，默认 `127.0.0.1`；仅在已保护后台时改为 `0.0.0.0` |
| `OPENCODE_MANAGER_SETTINGS_PATH` | 自定义设置文件路径 |
| `OPENCODE_MANAGER_STATS_PATH` | 自定义 Worker 统计文件路径 |
| `OPENCODE_MANAGER_MODELS_URL` | 覆盖用于刷新免费模型的 Zen 官方模型目录 URL |
| `OPENCODE_SYNTHESIZE_CLI_HEADERS` | 设为 `true` 时合成 CLI 身份请求头（也可在后台配置） |
| `OPENCODE_USER_AGENT` / `OPENCODE_CLIENT` / `OPENCODE_PROJECT` | 合成 CLI 身份请求头时使用的默认值 |

项目不会自动读取 `.env`；请使用 shell 环境变量，或通过 `node --env-file=.env dist/index.js` 启动。后台修改端口后需要重启服务。

> 安全提示：网关令牌只保护模型转发接口，不保护管理后台。管理 API 可读取 Zen Key、代理口令和订阅 URL，因此不要将管理端口直接暴露到公网或不可信局域网。

### OpenCode 原生接入

无需修改 OpenCode。在 `opencode.json` 中覆盖内置 `opencode` provider 的地址；启用网关访问令牌时，通过自定义请求头传递，不要把它配置成 Zen API Key：

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

网关令牌为空时保持原有的开放访问行为。当前版本只接入 Zen，不接入 OpenCode Go。

## 仅免费模型服务

本网关**只提供免费模型**——付费模型永远不会暴露给客户端。

- 启动时读取 OpenCode Zen 官方模型目录（`https://opencode.ai/zen/v1/models`），保留 `*-free` 模型 ID 和明确列入官方特殊免费白名单的模型。
- `GET /v1/models` 只返回这些免费模型（上游的付费条目会被丢弃）。
- `POST /v1/chat/completions` 和 `POST /v1/responses` 都会在**任何上游调用之前**，以 `403 model_not_allowed` 拒绝非免费模型的请求。
- 刷新结果缓存到 `data/free-models.json`。刷新失败时保留上一次成功的集合；首次成功刷新之前使用当前已知免费 ID 的静态基线。

静态基线模型（运行时会从 Zen 官方模型目录刷新，以后台/API显示为准）：

```text
big-pickle  deepseek-v4-flash-free  mimo-v2.5-free  laguna-s-2.1-free
ling-3.0-flash-free  longcat-2.0-free  north-mini-code-free  nemotron-3-ultra-free
```

## 代理池（OpenCode 免费账号的 IP 隔离）

OpenCode 免费账号经常受 **IP 限制**。将每个 Worker 绑定到不同的池代理：

先按代理来源选择一条导入路径，而不是依次执行所有方式：

1. **已有 HTTP/SOCKS5 地址** — 管理后台 → 代理池 → 手动添加，不需要 Clash 桥接。
2. **有标准订阅 URL** — 添加订阅 URL → **拉取**。
   - 会尝试多个 User-Agent（优先 `clash`，也包含 `0dcloud`）。部分机场只对特定客户端 UA 返回完整 YAML，其他 UA 可能返回 base64 的 `vless://` 列表或直接拒绝。
   - 导入 `http`/`socks`（直连）**以及** `vless`/`hysteria2`/`tuic`/…（经 Clash 桥接）
3. **节点已加载到 Clash/0dcloud** — 配置 Clash 桥接后点击 **导入 Controller 节点**，直接读取 Mihomo 当前运行时的选择组；无需让本项目再次下载订阅。
4. **VLESS/Hysteria2/TUIC 等协议节点** — 需要 Clash 桥接：
   - 在运行 opencode-manager 的同一台机器上运行 Mihomo/Clash Meta
   - 在管理后台开启桥接：controller `http://127.0.0.1:9090`、混合端口（通常是 `7892`）、选择组 `主代理`
   - 网关按 Worker 切换选择组，然后经本地 HTTP 代理出站
5. **绑定** — 每个 Worker 通过 `proxyId` 选择池中节点

订阅拉取和 Controller 导入不是同一份数据视图。前者只解析本次订阅 HTTP 响应中的顶层 `proxies` 或分享链接；后者读取 Mihomo 已经加载、缓存并展开 provider 后的运行时选择组。即使源头看似相同，节点数量也可能不同。

Clash 桥接包含两条独立链路：Controller URL/Secret 是切换节点和查询延迟的**控制面**；本地主机/mixed-port 是实际转发请求的**数据面**。这里的 `127.0.0.1` 始终指运行 opencode-manager 的机器，不是打开后台页面的浏览器所在机器。

导入后先测试候选节点。测试会先记录并持久化公网出口 IP，再用 `Bearer public` 发起一次真实匿名 Zen 免费模型请求；服务重启后仍会显示上一次成功测得的出口，失败探测不会清除该记录。只有匿名 Zen 成功的出口才参与自动分配。节点按真实出口 IP 去重，同一出口最多承载一个匿名 Worker 和一个登录 Worker。单个 mixed-port 使用共享选择组，网关会串行完成“切换节点 + 建立连接”；运行期间不要在其他客户端中切换同一个选择组。需要多个节点永久并行独占端口时，应为每个 Worker 配置独立的 Mihomo 入站或实例。

“批量测试”先通过 Mihomo 节点延迟接口筛选，再对每个不同公网出口执行匿名 Zen 验证。每个验证可用的唯一出口都会自动添加为匿名 Worker；你只需要手动添加登录 Zen 账号。重复或局部批测只会补充缺少的 Worker，不会重复创建或删除现有配置。普通代理检查最多 8 路并发；Clash 节点的公网 IP 和 Zen 请求复用一次 selector 切换。单个共享 Clash selector 的不同节点仍需串行处理，以避免出口串线。

Worker 页面可以设置调度策略，并控制每个 Worker 是否参与流量。默认“匿名优先”会在所有匿名 Worker 都不可用后才使用登录 Zen；“登录 Zen 优先”顺序相反；“混合轮询”按配置顺序调度。匿名探测和 Worker 连接测试都使用单 token 输入并限制 `max_tokens: 1`，尽量减少免费额度消耗。保存登录 Worker 后，可点击卡片中的“测试连接”验证具体 Key 和路由，结果包含 HTTP 状态、总延迟、节点和公网出口 IP。

总览页会区分客户端生成请求、Worker 上游尝试和 `/v1/models` 模型列表尝试；重试链只算一个客户端生成请求，Worker 行仍按实际路由尝试计数。全局模型分布按客户端请求链去重，各 Worker 则展示自己实际尝试过的模型。Token 仅累计上游成功响应中实际报告的 `usage`，界面会显示 usage 覆盖情况；缓存命中率按“缓存读取输入 Token / 总输入 Token”计算，并将缓存未命中与明确的缓存写入字段分开。Token 和缓存同时按模型聚合，切换模型后可在悬停详情中分别查看。路由前发生的失败会进入独立的网关拒绝列表，不归到任何 Worker。全局“重置统计”会同时清除 Worker 计数、上游尝试、最近错误和网关拒绝记录。

Worker 列表可以保存为空；此时转发接口会返回明确的 `503`，直到手动添加 Worker 或通过批量测试重新生成。Worker、IP 隔离、代理节点、上游尝试和网关拒绝等密集列表统一每页显示 8 条。桌面侧边栏和较长的状态区块均可折叠，浏览器会记住显示状态；移动端继续使用紧凑的横向导航。

后台详情提示统一使用支持键盘的浮层样式，悬浮或聚焦对应卡片、统计项或被截断的内容即可显示；浮层会自动上下翻转并限制在视口内，也会在按下 Escape、滚动或调整窗口时关闭。

## 测试

```bash
npm test
```

## 许可证

MIT

## 参考与致谢

- 原项目：[kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay)
- 原版权声明：Copyright (c) 2026 OCFreeRelay contributors.
- 感谢原作者及贡献者提供的初始实现。

## 社区

- [Linux.do](https://linux.do) — 开源与开发者社区讨论
