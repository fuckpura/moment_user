# Moment User

Public user web app for Moment.

## Development

```bash
bun install
bun run dev
```

The dev server proxies API calls to `http://127.0.0.1:28080` by default. Override it with:

```bash
API_PROXY_TARGET=http://127.0.0.1:28080 bun run dev
```

## Build

```bash
bun run build
```

Static files are written to `dist/`.

## Cloudflare Pages / Vercel

Use the deployment build command:

```bash
bun run build:deploy
```

Output directory:

```text
dist
```

Supported runtime environment variables:

```text
MOMENT_API_BASE_URL
MOMENT_BRAND_NAME
MOMENT_USER_LOGO_URL
MOMENT_FAVICON_URL
MOMENT_THEME_COLOR
MOMENT_FOOTER_TEXT
MOMENT_SUPPORT_EMAIL
```

Cloudflare Pages uses `public/_redirects` and `public/_headers`. Vercel uses `vercel.json`.

## Runtime Config

API address, logo, and brand copy are deployment-time config. Replace or mount `public/config.js` after build instead of baking those values into Vite output.
