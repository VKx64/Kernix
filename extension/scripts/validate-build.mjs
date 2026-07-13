import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '../dist')
const manifestPath = resolve(dist, 'manifest.json')
const packagePath = resolve(import.meta.dirname, '../package.json')
if (!existsSync(manifestPath)) throw new Error('dist/manifest.json is missing.')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const required = [...(manifest.permissions ?? [])].sort()
const optionalHosts = [...(manifest.optional_host_permissions ?? [])].sort()
if (manifest.manifest_version !== 3) throw new Error('The extension must use Manifest V3.')
if (packageJson.name !== 'kernix-companion' || manifest.name !== 'Kernix Companion') throw new Error('The Kernix Companion package identity is inconsistent.')
if (manifest.version !== packageJson.version) throw new Error(`Manifest version ${manifest.version} does not match package version ${packageJson.version}.`)
if (!manifest.description?.includes('Kernix')) throw new Error('The manifest description must identify Kernix.')
if (JSON.stringify(required) !== JSON.stringify(['alarms', 'storage'])) throw new Error(`Unexpected required permissions: ${required.join(', ')}`)
if (JSON.stringify(optionalHosts) !== JSON.stringify(['http://127.0.0.1/*', 'http://localhost/*', 'https://*/*'])) {
  throw new Error(`Unexpected optional host permissions: ${optionalHosts.join(', ')}`)
}
if (manifest.host_permissions?.length) throw new Error('Workspace hosts must remain optional permissions.')
for (const permission of ['tabs', 'history', 'idle', 'notifications', 'browsingData']) {
  if (required.includes(permission)) throw new Error(`Forbidden permission: ${permission}`)
}
if (manifest.content_scripts) throw new Error('Content scripts are outside the companion scope.')
if (manifest.background?.service_worker !== 'background.js' || manifest.background?.type !== 'module' || !existsSync(resolve(dist, 'background.js'))) {
  throw new Error('The deterministic Manifest V3 service worker is missing.')
}
if (manifest.action?.default_popup !== 'popup.html' || manifest.action?.default_title !== 'Kernix Companion') throw new Error('The extension action metadata is inconsistent.')
if (manifest.content_security_policy?.extension_pages !== "script-src 'self'; object-src 'self'") throw new Error('The extension content security policy is unexpected.')
for (const size of [16, 32, 48, 128]) {
  if (!existsSync(resolve(dist, `icons/icon-${size}.png`))) throw new Error(`Missing ${size}px extension icon.`)
}
const sourceMaps = readdirSync(dist, { recursive: true }).filter((file) => String(file).endsWith('.map'))
if (sourceMaps.length) throw new Error(`Source maps must not be packaged: ${sourceMaps.join(', ')}`)
