/** Everything the bridge reads from its environment, resolved once at boot. */
export interface BridgeConfig {
  host: string
  port: number
  /** Shared secret. The backend presents it here, and the bridge presents it back on the inbound callback. */
  token: string
  /** Directory the WhatsApp credentials live in. Must be on a persistent volume, or every restart asks for the QR again. */
  authDir: string
  /** Kernix API origin, container-to-container (e.g. http://backend:8000). */
  backendUrl: string
  /** Where inbound messages are posted. */
  inboundPath: string
  /** Device name shown in WhatsApp's "linked devices" list. */
  deviceName: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

export function loadConfig(): BridgeConfig {
  return {
    host: process.env.KERNIX_WHATSAPP_HOST?.trim() || '0.0.0.0',
    port: Number(process.env.KERNIX_WHATSAPP_PORT?.trim() || '8790'),
    token: required('KERNIX_WHATSAPP_TOKEN'),
    authDir: process.env.KERNIX_WHATSAPP_AUTH_DIR?.trim() || '/app/auth',
    backendUrl: (process.env.KERNIX_BASE_URL?.trim() || 'http://backend:8000').replace(/\/$/, ''),
    inboundPath: process.env.KERNIX_WHATSAPP_INBOUND_PATH?.trim() || '/api/whatsapp/inbound',
    deviceName: process.env.KERNIX_WHATSAPP_DEVICE_NAME?.trim() || 'Kernix',
  }
}
