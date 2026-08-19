# 项目架构

本文说明 OCFreeRelay 的代码边界、依赖方向和拆分原则。具体工程约束以根目录 `AGENTS.md` 为准。

## 运行时流程

```text
OpenCode / OpenAI-compatible client
              |
              v
        HTTP server/routes
          |           |
          v           v
   relay transform   admin operations
          |           |
          +-----+-----+
                v
       Worker/account routing
                |
                v
     proxy resolution / Clash bridge
                |
                v
          OpenCode Zen upstream
```

设置存储向 HTTP 装配和领域服务提供归一化配置；统计存储消费上游尝试事件。管理页面只通过 Admin API 观察和修改状态，不应成为服务端业务逻辑的来源。

## 目录职责

| 路径 | 职责 | 不应包含 |
| --- | --- | --- |
| `src/index.ts` | 进程启动和退出 | 路由、配置归一化、代理逻辑 |
| `src/server/` | HTTP 装配、公共响应工具、路由分发 | 协议解析、Worker 选择算法 |
| `src/server/routes/` | 按领域组织 Admin 与 Relay 路由 | 全部 API 的单一巨型 handler |
| `src/server/admin/` | 管理后台 HTML/CSS/JS 资源 | 服务端配置读写和转发逻辑 |
| `src/relay/` | 请求体、请求头、URL 和账号调度 | Node HTTP 对象、管理 UI |
| `src/proxy/` | 代理协议、订阅、Clash、探测和上游连接 | 页面渲染、配置文件持久化 |
| `src/settings/` | 设置归一化、持久化、统计 | HTTP 路由和 DOM 逻辑 |
| `tests/` | 与源码领域对应的单元/集成测试 | 真实凭证、真实网络依赖 |
| `scripts/` | 可重复的本地与 CI 工程检查 | 应用运行时业务逻辑 |

## 依赖方向

允许的主方向是：

```text
index -> server -> relay/proxy/settings
relay -> its own modules
proxy -> relay types/settings types when required
settings -> domain event types when required
```

需要避免：

- `relay/`、`proxy/` 或 `settings/` 导入 `server/`。
- 管理前端资源直接嵌入服务端领域实现。
- HTTP 路由直接实现订阅解析、代理分配或批测算法。
- 为了共享少量代码建立无边界的 `utils.ts`。

若两个领域出现循环依赖，先确认真正的数据所有者，再抽取窄接口或领域事件；不要通过扩大 barrel export 掩盖循环。

## HTTP 层拆分

HTTP 层应由一个小型装配模块和多个领域路由组成：

- Relay：模型列表、Chat Completions、鉴权、流式响应。
- Settings/Status：设置读写、运行状态、免费模型状态。
- Workers：启停、连接测试、统计重置、代理分配。
- Proxy Pool/Probe：节点增删、单测、批测状态与批测任务。
- Subscriptions/Clash：订阅拉取、Controller 探测和导入。

路由 handler 只做四件事：解析和校验请求、调用服务、映射 HTTP 响应、记录必要状态。批量测试等长流程应由独立服务维护状态机，使浏览器断开不会取消服务端任务。

## 管理后台拆分

管理后台按静态资源边界维护：

- HTML 只描述可访问的页面结构。
- CSS 管理主题、布局和响应式规则。
- JavaScript 按 API client、状态、渲染、批测轮询和事件绑定拆分。
- 中英文词条集中维护并保持键集合一致。

如果继续以内嵌字符串提供页面，也应从多个小资源模块组合，最终仅由一个入口导出完整 HTML。单个资源仍受 1000 行硬上限约束。

## 状态与持久化

- `GatewaySettings` 是持久化配置的唯一规范模型；所有外部输入先归一化再保存。
- 运行时统计和批测进度不得混入长期配置，除非具有明确迁移策略。
- 写入应保持原子性或可恢复性，加载损坏文件时不得泄漏内容。
- 修改配置格式时需要兼容旧数据的测试，并在使用指南中说明迁移影响。

## 自动检查

`npm run check:structure` 扫描 `src/`、`tests/` 和 `scripts/` 中的手写代码文件，拒绝超过 1000 行的文件，并提示超过 600 行的拆分目标。`npm run validate` 汇总结构检查、TypeScript 严格检查、构建和测试，作为本地提交与 CI 的统一入口。

推荐 CI 在 Node.js 20.18.1 或更高版本执行：

```bash
npm ci
npm run validate
git diff --check
```
