# Moment User

Moment User 是公开用户端，负责注册登录、购买、订单、订阅链接、订阅预设和工单等自助流程。这个目录可以作为独立 GitHub 仓库发布。

## Requirements

```text
Bun 1.3.1+
Node 20+
```

## Development

```bash
bun install
bun run dev
```

开发服务器默认把 API 代理到 `http://127.0.0.1:28080`。需要连接其他 server 时：

```bash
API_PROXY_TARGET=http://127.0.0.1:28080 bun run dev
```

## Build

```bash
bun run build
```

构建产物会写入 `dist/`。

## Deployment Build

Cloudflare Pages、Vercel 或静态文件部署都使用同一个命令：

```bash
bun run build:deploy
```

输出目录：

```text
dist
```

`build:deploy` 会在 `dist/config.js` 写入部署时配置。Vite bundle 本身不包含 API 地址、Logo 或品牌文案，因此同一个构建包可以在不同环境复用。

Cloudflare Pages 使用 `public/_redirects` 和 `public/_headers`；Vercel 使用 `vercel.json`。

## Runtime Config

支持的部署时环境变量：

```text
MOMENT_API_BASE_URL
MOMENT_BRAND_NAME
MOMENT_USER_LOGO_URL
MOMENT_FAVICON_URL
MOMENT_THEME_COLOR
MOMENT_FOOTER_TEXT
MOMENT_SUPPORT_EMAIL
```

本地默认配置在 `public/config.js`。生产部署可以直接替换最终站点根目录下的 `/config.js`，不需要重新构建前端。
