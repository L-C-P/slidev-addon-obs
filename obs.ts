// OBS remote control over obs-websocket (protocol v4 and v5), without dependencies.

export type ObsVersion = 4 | 5

/** `obs:` block in the headmatter */
export interface ObsOptions {
  host?: string
  port?: number | string
  password?: string
  version?: number | string
  /** Full WebSocket URL; overrides host/port. A path (`/obs`) is resolved against the current origin. */
  url?: string
  /** Windows that switch scenes: `all` (default), `presenter` or `play` */
  trigger?: 'all' | 'presenter' | 'play'
  /** Slides without `obsScene` keep the scene of the previous slide (default: true) */
  inherit?: boolean
  enabled?: boolean
}

export interface ObsConfig {
  url: string
  password: string
  version: ObsVersion
}

const LOG_PREFIX = '[slidev-addon-obs]'
const DEFAULT_PORTS: Record<ObsVersion, number> = { 4: 4444, 5: 4455 }
const MAX_RETRY_DELAY = 10_000
// obs-websocket v5 close code for a failed authentication
const AUTHENTICATION_FAILED = 4009

export function parseVersion(version: ObsOptions['version']): ObsVersion {
  const value = String(version ?? 5).trim().toLowerCase().replace(/^v/, '')
  if (value.startsWith('4'))
    return 4
  if (value.startsWith('5'))
    return 5
  console.warn(`${LOG_PREFIX} unknown version "${version}", using v5`)
  return 5
}

/** Parses `obsSceneDelay`: a number in milliseconds or a string like `500ms` / `1.5s`. */
export function parseDelay(delay: unknown): number {
  if (delay == null || delay === '')
    return 0
  const match = String(delay).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i)
  if (!match) {
    console.warn(`${LOG_PREFIX} invalid obsSceneDelay "${delay}", switching without delay`)
    return 0
  }
  const value = Number(match[1])
  return match[2]?.toLowerCase() === 's' ? value * 1000 : value
}

export function resolveObsConfig(options: ObsOptions, location?: { protocol: string, host: string }): ObsConfig {
  const version = parseVersion(options.version)
  const password = options.password == null ? '' : String(options.password)

  if (options.url) {
    let url = options.url
    if (url.startsWith('/') && location)
      url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${url}`
    return { url, password, version }
  }

  const host = (options.host || 'localhost').replace(/^wss?:\/\//, '')
  const hasPort = /:\d+$/.test(host)
  const port = options.port || DEFAULT_PORTS[version]
  return { url: `ws://${hasPort ? host : `${host}:${port}`}`, password, version }
}

interface PendingRequest {
  resolve: (data: any) => void
  reject: (error: Error) => void
}

export class ObsConnection {
  private ws?: WebSocket
  private ready = false
  private disposed = false
  private authFailed = false
  private requestCounter = 0
  private retryDelay = 1000
  private retryTimer?: ReturnType<typeof setTimeout>
  private pending = new Map<string, PendingRequest>()
  private pendingScene?: string
  private lastError?: string

  readonly config: ObsConfig

  constructor(config: ObsConfig) {
    this.config = config
  }

  connect(): void {
    if (this.disposed || this.authFailed || this.ws)
      return

    let ws: WebSocket
    try {
      ws = new WebSocket(this.config.url)
    }
    catch (error) {
      this.logError(`invalid URL ${this.config.url}: ${(error as Error).message}`)
      return
    }
    this.ws = ws

    ws.onopen = () => {
      if (this.config.version === 4)
        this.handshakeV4()
    }
    ws.onmessage = event => this.handleMessage(event.data)
    ws.onclose = (event) => {
      if (event.code === AUTHENTICATION_FAILED)
        this.failAuthentication('authentication failed: wrong password')
      this.handleClose()
    }
    ws.onerror = () => this.logError(`cannot connect to ${this.config.url}`)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.retryTimer)
    this.ws?.close()
  }

  /** Switches the program scene; queued until the connection is ready. */
  setScene(sceneName: string): void {
    this.pendingScene = sceneName
    if (this.ready)
      this.flushScene()
    else
      this.connect()
  }

  /** Sends a raw request in the configured protocol version. */
  request(requestType: string, requestData: Record<string, unknown> = {}): Promise<any> {
    if (!this.ready)
      return Promise.reject(new Error('not connected'))
    return this.send(requestType, requestData)
  }

  private flushScene(): void {
    const sceneName = this.pendingScene
    if (sceneName == null)
      return
    const request = this.config.version === 4
      ? this.send('SetCurrentScene', { 'scene-name': sceneName })
      : this.send('SetCurrentProgramScene', { sceneName })
    request.then(() => {
      if (this.pendingScene === sceneName)
        this.pendingScene = undefined
    }).catch((error) => {
      if (this.pendingScene === sceneName)
        this.pendingScene = undefined
      console.warn(`${LOG_PREFIX} cannot switch to scene "${sceneName}": ${error.message}`)
    })
  }

  private send(requestType: string, requestData: Record<string, unknown>): Promise<any> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('not connected'))

    const id = `slidev-${++this.requestCounter}`
    const message = this.config.version === 4
      ? { 'request-type': requestType, 'message-id': id, ...requestData }
      : { op: 6, d: { requestType, requestId: id, requestData } }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      ws.send(JSON.stringify(message))
    })
  }

  private async handshakeV4(): Promise<void> {
    let auth: any
    try {
      auth = await this.send('GetAuthRequired', {})
    }
    catch {
      // connection closed during the handshake; handleClose schedules the retry
      return
    }
    if (auth.authRequired) {
      try {
        await this.send('Authenticate', { auth: authenticate(this.config.password, auth.salt, auth.challenge) })
      }
      catch (error) {
        this.failAuthentication(`authentication failed: ${(error as Error).message}`)
        return
      }
    }
    this.handleReady()
  }

  private handleMessage(raw: unknown): void {
    let message: any
    try {
      message = JSON.parse(String(raw))
    }
    catch {
      return
    }

    if (this.config.version === 4) {
      const request = this.pending.get(message['message-id'])
      if (!request)
        return
      this.pending.delete(message['message-id'])
      if (message.status === 'ok')
        request.resolve(message)
      else
        request.reject(new Error(message.error || 'request failed'))
      return
    }

    const { op, d } = message
    if (op === 0) {
      // Hello
      const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: 0 }
      if (d.authentication)
        identify.authentication = authenticate(this.config.password, d.authentication.salt, d.authentication.challenge)
      this.ws?.send(JSON.stringify({ op: 1, d: identify }))
    }
    else if (op === 2) {
      // Identified
      this.handleReady()
    }
    else if (op === 7) {
      // RequestResponse
      const request = this.pending.get(d.requestId)
      if (!request)
        return
      this.pending.delete(d.requestId)
      if (d.requestStatus?.result)
        request.resolve(d.responseData ?? {})
      else
        request.reject(new Error(d.requestStatus?.comment || `error code ${d.requestStatus?.code}`))
    }
  }

  private handleReady(): void {
    this.ready = true
    this.retryDelay = 1000
    this.lastError = undefined
    console.info(`${LOG_PREFIX} connected to ${this.config.url} (v${this.config.version})`)
    this.flushScene()
  }

  private handleClose(): void {
    const wasReady = this.ready
    this.ws = undefined
    this.ready = false
    for (const request of this.pending.values())
      request.reject(new Error('connection closed'))
    this.pending.clear()

    if (wasReady)
      console.warn(`${LOG_PREFIX} connection to ${this.config.url} closed`)
    if (this.disposed || this.authFailed)
      return

    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.connect(), this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY)
  }

  private failAuthentication(message: string): void {
    this.authFailed = true
    this.logError(message)
    this.ws?.close()
  }

  // Logs each distinct error once until the next successful connection.
  private logError(message: string): void {
    if (message === this.lastError)
      return
    this.lastError = message
    console.error(`${LOG_PREFIX} ${message}`)
  }
}

/** obs-websocket auth string (identical in v4 and v5) */
export function authenticate(password: string, salt: string, challenge: string): string {
  const secret = base64(sha256(utf8(password + salt)))
  return base64(sha256(utf8(secret + challenge)))
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

// crypto.subtle is only available in secure contexts; the deck may be opened via http://<lan-ip>.
const K = new Uint32Array([
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
])

export function sha256(data: Uint8Array): Uint8Array {
  const length = data.length
  const padded = new Uint8Array(((length + 72) >> 6) << 6)
  padded.set(data)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000))
  view.setUint32(padded.length - 4, length << 3)

  const h = new Uint32Array([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++)
      w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = w[i - 16] + s0 + w[i - 7] + s1
    }

    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  h.forEach((value, i) => outView.setUint32(i * 4, value))
  return out
}
