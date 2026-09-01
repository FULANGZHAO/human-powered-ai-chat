# Human-Powered AI Chat

一个可自托管的 AI 风格实时聊天系统。用户端呈现熟悉的 AI 对话体验，管理员在独立控制台查看问题、实时输入并发送最终回答。

> 本项目适合人工客服、专家咨询、AI 原型验证和演示。对外使用时请明确披露回答由人工提供，避免误导用户。

## 功能

- AI 产品风格的响应式用户界面
- 密码保护的人工操作台和待回复队列
- 管理员输入内容实时同步到用户端
- WebSocket 断线重连
- JSON 文件持久化，无需数据库
- 浅色、深色和减少动画模式
- 自动适配任意反向代理子路径
- Docker 部署支持

## 快速开始

需要 Node.js 18 或更高版本。

```powershell
npm install
$env:APP_NAME="My Assistant"
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
| `APP_NAME` | `Human AI` | 用户端显示的产品名称 |
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

测试覆盖页面资源路径、管理员登录、用户提问、实时输入同步和最终回答。

## 生产环境说明

- 使用 HTTPS，并设置足够强的 `ADMIN_PASSWORD`。
- 单实例可以直接使用内置 JSON 存储。
- 多实例部署应将数据存储替换为 PostgreSQL/MySQL，并使用 Redis 管理实时连接和状态。
- 建议在反向代理层增加访问日志、速率限制和管理员入口保护。

## License

[MIT](LICENSE)
