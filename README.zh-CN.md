# opencode-manager

[English](README.md) | **简体中文**

本机运行的 OpenCode Zen 免费模型 OpenAI 兼容网关。它统一管理匿名和登录 Zen Worker，验证代理真实出口，并在健康 Worker 之间调度客户端请求。

## 核心能力

- 兼容 `/v1/chat/completions`、`/v1/responses` 和 `/v1/models`
- 只展示并允许调用免费模型
- 匿名 Zen 与登录 Zen Worker 分池管理，可配置调度优先级
- 支持 HTTP/SOCKS 代理、订阅导入和 Clash/Mihomo Controller
- 验证公网出口 IP，支持增量批测并自动创建匿名 Worker
- 本机管理后台统一管理网关、代理池、Workers、模型、客户端接入和用量统计

## 快速开始

需要 Node.js 20.18.1 或更高版本和 npm。只有无法直接作为 HTTP/SOCKS 代理使用的协议节点才需要 Clash/Mihomo。

```bash
git clone https://github.com/SSRosin8/opencode-manager.git
cd opencode-manager
npm ci
npm start
```

`npm start` 会构建并在后台启动服务，等待健康检查后输出管理后台地址。日常管理命令：

```bash
npm run status
npm run restart
npm stop
```

服务默认监听 `127.0.0.1:9876`。

- 管理后台：http://127.0.0.1:9876/
- OpenAI 兼容 Base URL：`http://127.0.0.1:9876/v1`
- 健康检查：`http://127.0.0.1:9876/health`

## 文档

- [本机使用指南](docs/USAGE.zh-CN.md)：安装、配置、代理导入、Workers、OpenCode 接入、备份和故障排查
- [English usage guide](docs/USAGE.md)
- [架构说明](docs/ARCHITECTURE.zh-CN.md)：模块职责、依赖方向和持久化边界
- [贡献规范](AGENTS.md)：仓库结构、安全要求和验证标准

安全提示：网关令牌只保护模型接口，不保护管理后台。除非已经单独保护 `/`、`/admin` 和 `/admin/api/*`，否则管理端口应只监听本机。

## 开发

```bash
npm run dev
npm run validate
```

## 许可证

MIT

## 参考与致谢

- 原项目：[kirafishy/OCFreeRelay](https://github.com/kirafishy/OCFreeRelay)
- 原版权声明：Copyright (c) 2026 OCFreeRelay contributors.
- 感谢原作者及贡献者提供的初始实现。
