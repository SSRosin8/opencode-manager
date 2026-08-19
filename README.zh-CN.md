# OCFreeRelay

[English](README.md) | **简体中文**

独立的 **OpenCode 免费 Worker** LLM 网关：一个 OpenAI 兼容的中继，用自己的 API Key 提供 OpenCode 免费模型。

> 本仓库基于 [kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay) 二次开发，并在此保留来源说明；新增本机 Clash Controller 节点导入、Worker 独立出口绑定、真实出口 IP 验证、快速批量测试和 Worker 真实连接测试等功能。

- 接受 **OpenAI 兼容**的客户端请求（`/v1/chat/completions`、`/v1/models`）
- **透明转发**到 `https://opencode.ai/zen/v1`（可配置）
- **仅免费模型**：自动抓取 Zen 定价页面，只提供免费模型（列表 + 对话）；付费模型永不暴露
- 匿名 Zen（自动使用 `Bearer public`）与登录 Zen Key 分池统计，可配置匿名优先、登录优先或混合调度
- 每个 Worker 可单独禁用，保留配置但不参与流量调度
- 按 OpenCode 会话粘性绑定 Worker；429、无效 Key 和临时上游故障自动切换
- 可选 **OpenCode CLI 身份请求头**合成（Cloudflare / VPS）
- 最小化的免费模型请求体修复（去除 `client_metadata`、思考模型的 `reasoning_content`、effort 别名等）
- `/` 提供**管理页面**，管理 Key、Base URL、代理和状态

## 快速开始

```bash
npm install
npm run build
npm start
# 或: npm run dev
```

默认端口：**9876**（可通过 `PORT` 或管理后台设置覆盖）。

- 管理后台：http://127.0.0.1:9876/
- 对话：`POST http://127.0.0.1:9876/v1/chat/completions`
- 模型列表：`GET http://127.0.0.1:9876/v1/models`

## 配置

| 来源 | 用途 |
|--------|---------|
| 管理后台 | Base URL、Worker（API Key）、代理池绑定、CLI 请求头合成 |
| `data/settings.json` | 持久化设置（自动创建） |
| `PORT` | 监听端口 |
| `OCFREERELAY_SETTINGS_PATH` | 自定义设置文件路径 |
| `OPENCODE_SYNTHESIZE_CLI_HEADERS` | 设为 `true` 合成 CLI 身份请求头（也可在管理后台开关） |
| `OPENCODE_USER_AGENT` / `OPENCODE_CLIENT` / `OPENCODE_PROJECT` | CLI 默认值 |
| `OCFREERELAY_PRICING_URL` | 覆盖用于抓取免费模型的 Zen 定价页面 URL |

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

- 启动时抓取 OpenCode Zen 定价页面（`https://opencode.ai/docs/zen`），保留所有输入/输出价格均为 `Free` 的模型。
- `GET /v1/models` 只返回这些免费模型（上游的付费条目会被丢弃）。
- `POST /v1/chat/completions` 会在**任何上游调用之前**，以 `403 model_not_allowed` 拒绝非免费模型的请求。
- 抓取结果缓存到 `data/free-models.json`。抓取失败时保留上一次成功的集合；首次成功抓取之前使用当前已知免费 ID 的静态基线。

当前免费模型：

```text
big-pickle  deepseek-v4-flash-free  mimo-v2.5-free  laguna-s-2.1-free
ling-3.0-flash-free  longcat-2.0-free  north-mini-code-free  nemotron-3-ultra-free
```

## 代理池（OpenCode 免费账号的 IP 隔离）

OpenCode 免费账号经常受 **IP 限制**。将每个 Worker 绑定到不同的池代理：

1. **手动** — 管理后台 → 代理池 → 添加 HTTP/SOCKS5 host:port
2. **Clash 订阅** — 添加订阅 URL → **拉取**（fetch）
   - 会尝试多个 User-Agent（优先 `clash`）。部分机场只有用 `clash` UA 才返回完整 YAML；其他 UA 返回 base64 的 `vless://` 列表。
   - 导入 `http`/`socks`（直连）**以及** `vless`/`hysteria2`/`tuic`/…（经 Clash 桥接）
3. **Clash 桥接** — 用于协议节点：
   - 本地运行 Mihomo/Clash Meta，使用**同一**订阅
   - 在管理后台开启桥接：controller `http://127.0.0.1:9090`、混合端口（通常是 `7892`）、选择组 `主代理`
   - 对于 0dcloud 等已把节点加载进 Mihomo 的客户端，可点击 **导入 Controller 节点**，无需再次下载订阅
   - 网关按 Worker 切换选择组，然后经本地 HTTP 代理出站
4. **绑定** — 每个 Worker 通过 `proxyId` 选择池中节点

导入后先测试候选节点。测试会先记录公网出口 IP，再用 `Bearer public` 发起一次真实匿名 Zen 免费模型请求；只有匿名 Zen 成功的出口才参与自动分配。节点按真实出口 IP 去重，同一出口最多承载一个匿名 Worker和一个登录 Worker。单个 mixed-port 使用共享选择组，网关会串行完成“切换节点 + 建立连接”；运行期间不要在其他客户端中切换同一个选择组。需要多个节点永久并行独占端口时，应为每个 Worker 配置独立的 Mihomo 入站或实例。

“批量测试”先通过 Mihomo 节点延迟接口筛选，再对每个不同公网出口执行匿名 Zen 验证。每个验证可用的唯一出口都会自动添加为匿名 Worker；你只需要手动添加登录 Zen 账号。重复或局部批测只会补充缺少的 Worker，不会重复创建或删除现有配置。普通代理检查最多 8 路并发；Clash 节点的公网 IP 和 Zen 请求复用一次 selector 切换。单个共享 Clash selector 的不同节点仍需串行处理，以避免出口串线。

Worker 页面可以设置调度策略，并控制每个 Worker 是否参与流量。默认“匿名优先”会在所有匿名 Worker 都不可用后才使用登录 Zen；“登录 Zen 优先”顺序相反；“混合轮询”按配置顺序调度。匿名探测和 Worker 连接测试都使用单 token 输入并限制 `max_tokens: 1`，尽量减少免费额度消耗。保存登录 Worker 后，可点击卡片中的“测试连接”验证具体 Key 和路由，结果包含 HTTP 状态、总延迟、节点和公网出口 IP。

总览页会按 Worker 统计真实 Chat 模型使用情况；`/v1/models` 模型列表请求会单独记录，不再与实际使用模型混淆。

Worker 列表可以保存为空；此时转发接口会返回明确的 `503`，直到手动添加 Worker 或通过批量测试重新生成。大量 Worker、状态指标、Worker 用量、IP 隔离和代理节点区块均可折叠，浏览器会记住显示状态。

## 测试

```bash
npm test
```

## 许可证

MIT

## 参考与致谢

- 原项目：[kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay)
- 感谢原作者及贡献者提供的初始实现。

## 社区

- [Linux.do](https://linux.do) — 开源与开发者社区讨论
