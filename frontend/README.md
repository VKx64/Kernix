# Kernix web client

React 19 and Vite 8 single-page client for the Kernix production management application.

## Requirements

- Node.js 22.12 or newer
- npm and the committed `package-lock.json`
- A running Kernix Laravel API

## Local development

```powershell
npm ci
npm run dev
```

The development server listens on `http://localhost:5173`. By default it proxies application requests to `http://backend:8000`, which is the backend service name used by Docker Compose. Set `VITE_PROXY_TARGET` in `.env.local` when Laravel runs elsewhere.

`VITE_API_ORIGIN` is optional. Leave it blank when the browser should use the same origin and reverse proxy as the web client. All `VITE_` variables are included in client-side configuration, so they must never contain secrets.

See `.env.example` for the supported variables.

## Verification

```powershell
npm run lint
npm test
npm run typecheck
npm run build
```

Run the complete local gate with `npm run check`. The production build is written to the ignored `dist/` directory and is served by Nginx in the production container.
