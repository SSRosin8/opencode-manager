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

`npm start` 是前台进程：保持终端打开，按 `Ctrl+C` 可优雅停止；关闭终端也会终止服务。它运行 `dist/`，修改源码或拉取新代码后应先重新执行 `npm run build`。开发模式使用 `npm run dev`，无需先构建。

项目当前不自带后台守护服务。若服务已经在另一个终端启动，先在那个终端按 `Ctrl+C`，或找到准确 PID 后执行 `kill -TERM <PID>`，再启动新版本。可用以下命令确认端口监听者：

```bash
ss -ltnp | grep ':9876'
# macOS 可用：lsof -nP -iTCP:9876 -sTCP:LISTEN
```

后台修改监听端口后必须重启。项目不会自动加载 `.env`；临时修改端口可使用：

```bash
PORT=9988 npm start
```

默认只监听 `127.0.0.1`。如确需监听其他网卡，可设置 `OPENCODE_MANAGER_HOST=0.0.0.0`，但必须通过防火墙或反向代理单独保护管理后台。

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

先根据手头已有的代理来源选择路径：

| 现有资源 | 推荐路径 | 是否需要 Clash 桥接 |
|---|---|---|
| HTTP/SOCKS5 地址 | 手动加入代理池 | 否 |
| 标准订阅 URL | 添加订阅并点击“拉取” | HTTP/SOCKS 节点不需要；协议节点需要 |
| 节点已加载在 Clash/0dcloud | 配置桥接并“导入 Controller 节点” | 是 |
| Controller 密钥不可获取 | 使用独立、可控的 Mihomo 实例，或只使用 HTTP/SOCKS 代理 | 取决于所选路径 |

拉取订阅时会尝试多个客户端 User-Agent，包括 `clash` 和 `0dcloud`，因为部分服务商只向特定客户端返回内容或允许访问。订阅拉取只解析**当前 HTTP 响应**里的顶层 Clash `proxies` 或多行分享链接；不会读取 Clash 客户端的本地缓存，也不会展开响应中的远程 `proxy-providers`。

“导入 Controller 节点”读取的是 Mihomo 当前运行时 Selector 中已经加载的叶子节点。Mihomo 可能已经使用缓存、展开 provider 或合并其他来源。因此，即使订阅 URL 看起来相同，直接拉取的节点数和 Controller 导入数也不要求一致。

HTTP/SOCKS5 代理可直接添加，不需要 Clash 桥接。VLESS、Hysteria2、TUIC、AnyTLS 等协议节点需要本机 Mihomo/Clash Meta：

1. 在 Clash 客户端中加载节点并开启 External Controller，常见地址为 `http://127.0.0.1:9090`。
2. 确认本地 mixed-port，例如 `7890` 或客户端实际端口。
3. 确认承载节点的 Selector 组名，例如 `Proxy` 或 `主代理`。
4. 在“代理池 → Clash 桥接”填写 Controller URL、Secret、本地主机、端口和选择组，开启桥接并保存。
5. 点击测试连接。成功后可点击“导入 Controller 节点”。

桥接有两条独立链路：

- **控制面**：Controller URL 和 Secret，用于读取节点、查询延迟和切换 Selector；常见端口是 `9090`。
- **数据面**：本地主机和 mixed-port，用于真正转发 HTTP 请求；常见端口是 `7890`、`7892` 或客户端给出的端口。

两条链路都必须可用。Controller 测试成功不代表 mixed-port 一定能转发流量。字段中的 `127.0.0.1` 指运行 opencode-manager 的机器；如果 Clash 在另一台机器上，不能用 `127.0.0.1` 指向它，也不应在未做访问控制时把 Controller 暴露到局域网。

选择组必须能直接选择叶子节点。网关运行批测或转发时，不要在其他客户端同时切换同一个选择组，否则出口可能串线。

`Proxy` 和 `GLOBAL` 都是选择器/路由组，不是两套节点或两份额度。`GLOBAL` 通常控制 Clash 的全局模式，`Proxy` 等自定义组通常承接规则模式中的流量；应选择当前运行模式实际使用、且能直接切换叶子节点的组。常见配置中，`GLOBAL` 的成员可能只是 `Proxy`、`DIRECT` 等上层策略，此时不能把它当作叶子节点组导入。项目会按 Controller 地址和叶子节点名识别节点，先后从 `Proxy`、`GLOBAL` 导入同一批节点不会再产生重复记录。切换同一 Controller 的选择器后重新导入会替换当前节点视图并迁移仍存在节点的 Worker 绑定；换了 Controller 地址则不会沿用旧出口状态，Worker 需要重新绑定和测试。

## 5. 建立匿名 Zen Worker

导入节点后，可以测试单个节点，也可以点击“批量测试”。单节点测试同样会获取公网出口 IP 并发送最小匿名 Zen 请求；验证成功后会立即创建对应匿名 Worker，重复测试不会重复创建。

批量测试分两阶段：

- “正在筛选节点”：并发调用 Mihomo delay API，快速排除明显不可达节点。
- “正在验证节点”：切换节点，获取公网出口 IP，再发送一个最小匿名 Zen 请求。

共享 Clash Selector 必须逐节点串行验证，这是为了保证出口不串线。每发现一个匿名 Zen 可用的唯一出口，系统会立即：

1. 保存探测结果和公网 IP；
2. 创建对应匿名 Worker。

批测期间，界面会动态更新进度、已完成节点、健康汇总和 Workers 指标，但不会重建整组指标卡，因此不会反复闪烁。Workers 列表和 IP 隔离概览在整批结束后统一刷新。点击“暂停”会让当前在途节点完成后停止领取后续节点，点击“继续”恢复；点击“取消”会中止在途网络请求、清除尚未执行的节点，并保留已经完成的探测结果和已创建 Worker。相同公网出口只创建一个匿名 Worker；代理池节点本身仍会保留。批测使用单字符输入和 `max_tokens: 1`，尽量减少额度消耗。

“删除全部代理”会清空整个代理池和探测缓存，并解除所有 Worker 的代理绑定；Worker、订阅和 Clash 桥接配置会保留，之后可以重新拉取或导入节点。批测运行期间不能执行此操作。

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

## 10. 最短分层验收路径

按以下顺序验证；在哪一步失败，就只排查该层：

1. **服务进程**：`curl http://127.0.0.1:9876/health` 应返回 `ok: true`。
2. **代理来源**：订阅卡显示拉取成功并有合理的节点数，或 Controller 导入成功并显示正确选择组。
3. **Clash 控制面**：后台“测试连接”成功，且能识别目标 Selector。
4. **Clash 数据面**：先测试一个节点，确认能得到公网出口 IP；不要一开始就运行整批。
5. **Worker**：确认至少一个 Worker 为启用、就绪，并绑定预期代理。
6. **模型接口**：调用 `/v1/models`，确认令牌和免费模型列表正常。
7. **对话接口**：最后调用一次最小 `/v1/chat/completions` 请求。

若没有使用 Clash，跳过第 3 步；HTTP/SOCKS 代理仍需通过第 4 步验证真实出口。

## 11. 数据、备份与升级

默认数据文件：

- `data/settings.json`：Worker、Key、代理、订阅和后台配置；需要保密。
- `data/worker-stats.json`：用量和请求尝试统计。
- `data/free-models.json`：免费模型缓存，可重新生成。

可通过 `OPENCODE_MANAGER_SETTINGS_PATH` 和 `OPENCODE_MANAGER_STATS_PATH` 修改前两项路径。备份或迁移前先停止服务，然后复制 `data/`。升级前先停止现有前台进程，避免新旧进程争用同一端口：

```bash
git pull --ff-only
npm ci
npm run build
npm test
npm start
```

## 12. 常见问题

### 批测长时间运行

先看按钮是“筛选”还是“验证”。验证 Clash 节点必须串行，失联节点还会等待 IP/Zen 超时。页面会自动轮询，刷新后也会恢复当前任务。不要同时切换同一个 Clash Selector。

### `503 no_workers_configured`

当前没有 Worker。运行批量测试生成匿名 Worker，或手动添加登录 Zen Worker。

### `503 no_enabled_workers`

所有 Worker 都被禁用，至少启用一个并保存。

### Worker 测试失败

根据结果区分出口探测失败、401/403 Key 无效、429 额度耗尽和 5xx 临时故障。登录 Worker 的 Key 与匿名 Zen 额度是分别测试的。

### Controller 连接失败

按错误现象定位：

| 现象 | 含义和检查项 |
|---|---|
| 连接拒绝或超时 | Controller 地址/端口错误，或 Mihomo 未监听 |
| `401 Unauthorized` | Controller 可达但 Secret 缺失或不匹配；部分客户端不向用户开放内部 Secret |
| `404` | 访问的通常不是 Clash Controller 端口或路径 |
| `selector group not found` | 选择组名称不匹配；使用连接测试返回的 Selector 名称 |
| Controller 成功但节点测试失败 | 继续检查 mixed-port、运行模式、选择组是否实际承载流量，以及数据面出口 |

### 订阅拉取失败或节点过少

| 现象 | 含义和检查项 |
|---|---|
| `403` | 服务商按 User-Agent、来源 IP 或订阅权限拒绝请求 |
| `504` | 订阅服务器的网关无法及时访问其上游；不是本项目的解析错误 |
| 拉取成功但节点明显少 | 当前响应可能是不同 UA 格式、单节点响应或 provider 配置；它不等于 Clash 已缓存并展开的运行时节点 |
| Controller 节点比订阅多 | Controller 展示的是 Mihomo 当前内存中的最终 Selector，可能包含缓存、已展开 provider 或其他来源 |

订阅 URL 通常含访问令牌。排查时不要把完整 URL、响应正文或 Secret 发到公开日志和问题报告中。

### 端口已占用

```bash
PORT=9988 npm start
```

后台端口设置只在下次启动生效。

## 13. 当前限制

- 当前只支持 Zen，不处理 OpenCode Go。
- 一个共享 Clash Selector 无法同时稳定承载多个不同出口；需要真正并发时，应配置独立 Mihomo 入站或实例。
- 常规上游转发尚未设置统一请求超时；极端失联上游可能长时间等待。
- 管理后台没有独立认证，必须依赖本机监听、网络隔离或反向代理保护。
