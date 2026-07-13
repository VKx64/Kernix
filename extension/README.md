# Kernix Companion

Chrome and Edge Manifest V3 companion for the Kernix web application. Source is kept with Kernix, while signed browser-store distribution remains private.

## Requirements

- Node.js 22.12 or newer
- npm and the committed `package-lock.json`
- Chrome or Edge with Manifest V3 support

## Development install

```powershell
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this package's `dist` directory.
4. In Kernix, open **Profile → Browser extension** and generate a pairing code.
5. Open the extension, enter the web application's origin (for example `http://localhost:5173`) and the code.

The extension requests host access only for the entered workspace. Local HTTP is accepted only for `localhost` and `127.0.0.1`; deployed workspaces require HTTPS.

## Verification and private package

```powershell
npm test
npm run lint
npm run typecheck
npm run package
```

Run the complete source gate with `npm run check`. The build validator checks the package/manifest version, Kernix identity, exact required and optional permissions, packaged service worker, content security policy, icons, and absence of source maps.

`npm run package` writes a deterministic, versioned Chromium ZIP under the ignored `artifacts/` directory. Upload the same build through the organization's private Chrome Web Store and Microsoft Edge Add-ons distribution channels. Store signing and managed deployment policy are intentionally external to this repository.

## Security and privacy

- Required permissions are limited to local storage and the refresh alarm.
- Host access is optional and requested only for the workspace origin entered during pairing.
- Local HTTP is restricted to loopback development; deployed workspaces require HTTPS.
- The extension has no content scripts and does not read browsing history or visited pages.
- The short-lived pairing exchange stores its resulting token only in extension-local storage. Users can revoke paired devices from their Kernix profile.

Never commit store signing keys, pairing codes, access tokens, local `.env` files, `dist/`, or packaged artifacts.
