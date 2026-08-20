# 本机使用指南

本文从空环境开始，完成本机启动、代理导入、匿名/登录 Zen Worker 配置、OpenCode 接入和故障排查。当前版本只支持 Zen，不接入 OpenCode Go，并只允许运行时识别出的免费模型。

## 1. 安装与启动

需要 Node.js 20.18.1 或更高版本：

```bash
node --version
git clone https://github.com/SSRosin8/opencode-manager.git
cd opencode-manager
npm ci
npm run build
npm start
```

打开 http://127.0.0.1:9876/，或检查：

```bash
curl http://127.0.0.1:9876/health
```

开发模式使用 `npm run dev`，无需先构建。后台修改监听端口后必须重启。项目不会自动加载 `.env`；临时修改端口可使用：

```bash
PORT=9988 npm start
```

默认只监听 `127.0.0.1`。如确需监听其他网卡，可设置 `OCFREERELAY_HOST=0.0.0.0`，但必须通过防火墙或反向代理单独保护管理后台。

## 2. 安全边界

- `X-OC-Relay-Key` 只保护 `/v1/*`、`/models` 和 `/chat/completions`。
- `/` 和 `/admin/api/*` 不受该令牌保护。
- 管理 API 包含 Zen Key、代理口令、Clash secret 和带 token 的订阅 URL。
- 不要把 9876 端口直接暴露到公网或不可信局域网。
- `data/settings.json` 包含凭证，不要提交到 Git 或发送给他人。

如需让其他设备调用，建议只对外发布 `/v1/*`，并在反向代理层禁止 `/admin`、`/admin/api/*` 和 `/`。

## 3. 首次网关配置

进入“网关”页面：

1. Base URL 保持 `https://opencode.ai/zen/v1`。
2. 建议设置网关访问令牌；客户端通过 `X-OC-Relay-Key` 传递。
3. CLI 身份头合成通常保持关闭；VPS/Cloudflare 环境需要时再开启。
4. 点击“保存更改”。

## 4. 准备 Clash/Mihomo

HTTP/SOCKS5 代理可直接添加，不需要 Clash 桥接。VLESS、Hysteria2、TUIC、AnyTLS 等协议节点需要本机 Mihomo/Clash Meta：

1. 在 Clash 客户端中加载节点并开启 External Controller，常见地址为 `http://127.0.0.1:9090`。
2. 确认本地 mixed-port，例如 `7890` 或客户端实际端口。
3. 确认承载节点的 Selector 组名，例如 `Proxy` 或 `主代理`。
4. 在“代理池 → Clash 桥接”填写 Controller URL、Secret、本地主机、端口和选择组，开启桥接并保存。
5. 点击测试连接。成功后可点击“导入 Controller 节点”。

选择组必须能直接选择叶子节点。网关运行批测或转发时，不要在其他客户端同时切换同一个选择组，否则出口可能串线。

`Proxy` 和 `GLOBAL` 都是选择器/路由组，不是两套节点或两份额度。`GLOBAL` 通常控制 Clash 的全局模式，`Proxy` 等自定义组通常承接规则模式中的流量；应选择当前运行模式实际使用、且能直接切换叶子节点的组。常见配置中，`GLOBAL` 的成员可能只是 `Proxy`、`DIRECT` 等上层策略，此时不能把它当作叶子节点组导入。项目会按 Controller 地址和叶子节点名识别节点，先后从 `Proxy`、`GLOBAL` 导入同一批节点不会再产生重复记录。切换同一 Controller 的选择器后重新导入会替换当前节点视图并迁移仍存在节点的 Worker 绑定；换了 Controller 地址则不会沿用旧出口状态，Worker 需要重新绑定和测试。

## 5. 建立匿名 Zen Worker

导入节点后，可以测试单个节点，也可以点击“批量测试”。单节点测试同样会获取公网出口 IP 并发送最小匿名 Zen 请求；验证成功后会立即创建对应匿名 Worker，重复测试不会重复创建。

批量测试分两阶段：

- “正在筛选节点”：并发调用 Mihomo delay API，快速排除明显不可达节点。
- “正在验证节点”：切换节点，获取公网出口 IP，再发送一个最小匿名 Zen 请求。

共享 Clash Selector 必须逐节点串行验证，这是为了保证出口不串线。每发现一个匿名 Zen 可用的唯一出口，系统会立即：

1. 保存探测结果和公网 IP；
2. 创建对应匿名 Worker；
3. 更新 Workers 页面和 IP 隔离概览。

不需要等待整批结束。相同公网出口只创建一个匿名 Worker；代理池节点本身仍会保留。批测使用单字符输入和 `max_tokens: 1`，尽量减少额度消耗。

## 6. 添加登录 Zen Worker

进入“Workers”页面：

1. 点击“添加登录 Zen”。
2. 类型选择“登录 Zen Key”。
3. 填写唯一 ID 和 Zen API Key。
4. 绑定一个已经验证的代理节点。
5. 保存 Workers。
6. 点击该 Worker 的“测试连接”。

登录 Worker 测试会检查公网出口，然后直接使用该登录 Key 请求最小模型，不会先消耗匿名 Zen 额度。可用开关会保留配置但停止流量调度。

## 7. 选择调度策略

- 匿名优先：先用所有可用匿名 Worker，全部不可用后使用登录 Zen。
- 登录 Zen 优先：先用登录 Zen，再回退到匿名 Worker。
- 混合轮询：按 Worker 配置顺序选择。

网关会保持 OpenCode 会话与 Worker 的粘性，以提高缓存命中；遇到 401、403、429、5xx 或传输错误时切换 Worker并进入冷却。

## 8. 接入 OpenCode

在项目目录或 OpenCode 全局配置位置创建/修改 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode": {
      "options": {
        "baseURL": "http://127.0.0.1:9876/v1",
        "headers": {
          "X-OC-Relay-Key": "替换为网关访问令牌"
        }
      }
    }
  }
}
```

未设置网关令牌时可以删除 `headers`。修改后重新加载 provider 配置或重启 OpenCode。模型提供商仍选择 OpenCode/Zen，模型请求会进入本网关；`opencode/big-pickle` 前缀也会被规范化。

## 9. 独立验证

设置了网关令牌时：

```bash
export RELAY_KEY='替换为网关令牌'

curl -sS http://127.0.0.1:9876/v1/models \
  -H "X-OC-Relay-Key: $RELAY_KEY"

curl -sS http://127.0.0.1:9876/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "X-OC-Relay-Key: $RELAY_KEY" \
  -d '{"model":"big-pickle","messages":[{"role":"user","content":"hi"}],"max_tokens":8}'
```

令牌为空时移除对应 header。付费或未知模型会在请求上游前返回 `403 model_not_allowed`。

## 10. 数据、备份与升级

默认数据文件：

- `data/settings.json`：Worker、Key、代理、订阅和后台配置；需要保密。
- `data/worker-stats.json`：用量和请求尝试统计。
- `data/free-models.json`：免费模型缓存，可重新生成。

可通过 `OCFREERELAY_SETTINGS_PATH` 和 `OCFREERELAY_STATS_PATH` 修改前两项路径。备份或迁移前先停止服务，然后复制 `data/`。升级步骤：

```bash
git pull --ff-only
npm ci
npm run build
npm test
npm start
```

## 11. 常见问题

### 批测长时间运行

先看按钮是“筛选”还是“验证”。验证 Clash 节点必须串行，失联节点还会等待 IP/Zen 超时。页面会自动轮询，刷新后也会恢复当前任务。不要同时切换同一个 Clash Selector。

### `503 no_workers_configured`

当前没有 Worker。运行批量测试生成匿名 Worker，或手动添加登录 Zen Worker。

### `503 no_enabled_workers`

所有 Worker 都被禁用，至少启用一个并保存。

### Worker 测试失败

根据结果区分出口探测失败、401/403 Key 无效、429 额度耗尽和 5xx 临时故障。登录 Worker 的 Key 与匿名 Zen 额度是分别测试的。

### Controller 连接失败

检查 Controller URL、Secret、mixed-port 和选择组名称；确认 Mihomo 正在运行且选择组中包含可选叶子节点。

### 端口已占用

```bash
PORT=9988 npm start
```

后台端口设置只在下次启动生效。

## 12. 当前限制

- 当前只支持 Zen，不处理 OpenCode Go。
- 一个共享 Clash Selector 无法同时稳定承载多个不同出口；需要真正并发时，应配置独立 Mihomo 入站或实例。
- 常规上游转发尚未设置统一请求超时；极端失联上游可能长时间等待。
- 管理后台没有独立认证，必须依赖本机监听、网络隔离或反向代理保护。
