# FakeAI — 真人后台操控的恶搞 AI

这是一个用于整活和恶搞的“假 AI”聊天项目。

用户看到的是一个几乎和常见 AI 产品一样的聊天网页，以为自己正在和 AI 对话；实际上，用户发送的问题会实时出现在管理员后台，由真人输入并返回答案。管理员打字时，用户端还会显示类似 AI 逐字生成回答的效果。

简单来说：

```text
用户以为：用户 ↔ AI
真实情况：用户 ↔ 管理员真人
```

适合朋友之间整活、聚会互动、直播节目效果、FakeAI 演示和人机交互实验。请只在合法、友善、不会造成实际损失的场景中使用，并在恶搞结束后及时向参与者说明真相。不要用于诈骗、冒充真实服务、套取隐私或其他欺骗性用途。

## 它是怎么工作的？

1. 用户打开 FakeAI 页面并输入问题。
2. 问题通过 WebSocket 实时发送到管理员控制台。
3. 管理员查看上下文并开始打字。
4. 管理员输入的内容会实时出现在用户端，看起来像 AI 正在生成答案。
5. 管理员点击发送后，回答成为正式聊天消息，用户可以继续追问。

## 功能

- 高度仿真的 AI 产品网页对话界面
- 密码保护的真人后台和待回复队列
- 用户问题实时送到管理员端
- 管理员打字过程实时伪装成 AI 生成效果
- WebSocket 断线重连
- JSON 文件持久化，无需数据库
- 浅色、深色和减少动画模式
- 自动适配任意反向代理子路径
- Docker 部署支持

## 快速开始

需要 Node.js 18 或更高版本。

```powershell
npm install
$env:APP_NAME="Super AI"
$env:ADMIN_PASSWORD="请设置一个强密码"
npm start
```

打开：

- 用户端：`http://localhost:3000/`
- 管理端：`http://localhost:3000/admin`
- 健康检查：`http://localhost:3000/health`

如果没有设置 `ADMIN_PASSWORD`，服务启动时会在终端显示一个本次运行临时生成的管理员密码。重启后该临时密码会改变。

## Docker

```powershell
docker build -t human-powered-ai-chat .
docker run --rm -p 3000:3000 -e APP_NAME="My Assistant" -e ADMIN_PASSWORD="change-me" -v human-ai-data:/app/data human-powered-ai-chat
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 服务端口 |
| `APP_NAME` | `Human AI` | 用户端显示的假 AI 名称，可自由修改 |
| `ADMIN_PASSWORD` | 自动生成 | 管理员登录密码 |
| `DATA_FILE` | `data/conversations.json` | 可选的聊天数据文件路径 |

## 反向代理子路径

项目既可部署在域名根路径，也可挂载在任意子路径，例如 `/your-prefix`。

反向代理需要：

1. 去掉外部请求的子路径前缀，再转发到 `127.0.0.1:3000`。
2. 设置请求头 `X-Forwarded-Prefix: /your-prefix`。
3. 正确转发 WebSocket 的 `Upgrade` 和 `Connection` 请求头。

应用会自动生成正确的 CSS、JavaScript、API 和 WebSocket 地址，不需要在源码中写死域名或前缀。

Nginx 示例：

```nginx
location /your-prefix/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Prefix /your-prefix;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## 测试

```powershell
npm run check
npm test
```

测试覆盖页面资源路径、管理员登录、用户提问、真人实时输入伪装和最终回答。

## 生产环境说明

- 使用 HTTPS，并设置足够强的 `ADMIN_PASSWORD`。
- 单实例可以直接使用内置 JSON 存储。
- 多实例部署应将数据存储替换为 PostgreSQL/MySQL，并使用 Redis 管理实时连接和状态。
- 建议在反向代理层增加访问日志、速率限制和管理员入口保护。

## License

[MIT](LICENSE)
