import { DEFAULT_PORT, RECONNECT_CAP_MS } from "./types"
import type { HotlineRequest, HotlineResponse } from "./types"

// ── Types ──

export interface HotlineOptions {
  port?: number
  appId: string
  handlers?: Record<string, (payload: any) => any | Promise<any>>
}

export interface Hotline {
  connect(): void
  disconnect(): void
  handle(type: string, fn: (payload: any) => any | Promise<any>): void
}

// ── Client ──

export function createHotline(options: HotlineOptions): Hotline {
  const port = options.port ?? DEFAULT_PORT
  const handlers = new Map<string, (payload: any) => any | Promise<any>>()
  let ws: WebSocket | null = null
  let reconnectDelay = 1000
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let intentionalClose = false

  // Register initial handlers
  if (options.handlers) {
    for (const [type, fn] of Object.entries(options.handlers)) {
      handlers.set(type, fn)
    }
  }

  // Built-in ping handler
  handlers.set("ping", () => ({}))

  function connect() {
    // @ts-ignore — __DEV__ is defined in React Native
    if (typeof __DEV__ !== "undefined" && !__DEV__) return

    intentionalClose = false
    const url = `ws://localhost:${port}`

    ws = new WebSocket(url)

    ws.onopen = () => {
      reconnectDelay = 1000
      // Register with server
      ws!.send(JSON.stringify({
        type: "register",
        role: "app",
        appId: options.appId,
      }))
    }

    ws.onmessage = async (event) => {
      let msg: HotlineRequest
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }

      if (!msg.id || !msg.type) return

      const handler = handlers.get(msg.type)
      if (handler) {
        try {
          const result = await handler(msg.payload ?? {})
          const response: HotlineResponse = {
            id: msg.id,
            ok: true,
            data: result ?? null,
          }
          ws?.send(JSON.stringify(response))
        } catch (err: any) {
          const response: HotlineResponse = {
            id: msg.id,
            ok: false,
            error: err?.message ?? "Handler error",
          }
          ws?.send(JSON.stringify(response))
        }
      } else {
        const response: HotlineResponse = {
          id: msg.id,
          ok: false,
          error: `Unknown command: ${msg.type}`,
        }
        ws?.send(JSON.stringify(response))
      }
    }

    ws.onclose = () => {
      ws = null
      if (!intentionalClose) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose will fire after this
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_CAP_MS)
      connect()
    }, reconnectDelay)
  }

  function disconnect() {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
  }

  function handle(type: string, fn: (payload: any) => any | Promise<any>) {
    handlers.set(type, fn)
  }

  return { connect, disconnect, handle }
}

// ── React Hook ──

let useRef: any
let useEffect: any

try {
  const React = require("react")
  useRef = React.useRef
  useEffect = React.useEffect
} catch {
  // React not available — hook will throw at call site
}

export function useHotline(options: HotlineOptions): Hotline {
  if (!useRef || !useEffect) {
    throw new Error("useHotline requires React")
  }

  const ref = useRef(null) as { current: Hotline | null }

  if (!ref.current) {
    ref.current = createHotline(options)
  }

  useEffect(() => {
    ref.current!.connect()
    return () => ref.current!.disconnect()
  }, [])

  return ref.current
}
