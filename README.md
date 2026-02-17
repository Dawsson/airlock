# hotline

Local WebSocket dev bridge for React Native apps. Send commands and query state from CLI tools, test frameworks (Maestro), or AI agents — with multi-app and multi-agent support.

```
Agent A ──┐                          ┌── App "com.foo" (Simulator 1)
Agent B ──┤── ws://localhost:8675 ──┤── App "com.bar" (Simulator 2)
Agent C ──┘     (relay server)       └── App "com.foo" (Simulator 3)
```

Port 8675 — the first four digits of 867-5309.

## Quick Start

```bash
# Start the server
hotline start --daemon

# Check what's connected
hotline status

# Send a command to your app
hotline cmd ping
hotline cmd get-state --payload '{"key":"user"}' --app com.example.myapp

# Query shorthand
hotline query user --app com.example.myapp

# Stop the server
hotline stop
```

## React Native Setup

```bash
bun add hotline
```

```tsx
import { useHotline } from "hotline/src/client"

function App() {
  const hotline = useHotline({
    appId: "com.example.myapp",
    handlers: {
      "get-state": ({ key }) => {
        return store.getState()[key]
      },
      "navigate": ({ screen }) => {
        navigation.navigate(screen)
      },
    },
  })

  return <YourApp />
}
```

Or without the hook:

```ts
import { createHotline } from "hotline/src/client"

const hotline = createHotline({
  appId: "com.example.myapp",
})

hotline.handle("get-state", ({ key }) => store.getState()[key])
hotline.connect()
```

The client automatically:
- Registers with the server using your `appId`
- Reconnects with exponential backoff (1s → 30s cap)
- No-ops in production (`__DEV__` guard)
- Responds to `ping` commands built-in

## CLI Usage

| Command | Description |
|---------|-------------|
| `hotline start` | Start server in foreground |
| `hotline start --daemon` | Start as background process |
| `hotline stop` | Stop daemonized server |
| `hotline status` | Show connected apps |
| `hotline cmd <type> [--payload '{}'] [--app <id>]` | Send command to app |
| `hotline query <key> [--app <id>]` | Shorthand for `get-state` |
| `hotline setup [--port N]` | Install macOS launchd service |
| `hotline teardown` | Remove launchd service |
| `hotline logs` | Tail server log file |

**Flags:** `--port <N>` (default 8675), `--timeout <ms>` (default 5000), `--app <appId>`

**Output:** stdout = JSON data only (pipeable). stderr = logs/errors. Exit 0 = success, 1 = error.

## Maestro Integration

```yaml
- runScript:
    script: |
      const result = exec("hotline cmd get-state --payload '{\"key\":\"user\"}'")
      assertTrue(JSON.parse(result).name === "Dawson")
```

## Multi-App Routing

When multiple apps are connected, use `--app` to target a specific one:

```bash
hotline cmd ping --app com.foo
hotline cmd get-state --payload '{"key":"auth"}' --app com.bar
```

If only one app is connected, `--app` is optional — it auto-selects.

## Lifecycle

```bash
# One-time: install as a launchd service (auto-starts on login)
hotline setup

# Or run manually
hotline start --daemon

# View logs
hotline logs

# Remove the launchd service
hotline teardown
```

## Protocol

JSON over WebSocket. Every request has a unique `id` (UUID).

```jsonc
// Request (CLI → Server → App)
{ "id": "uuid", "type": "get-state", "payload": { "key": "user" } }

// Response (App → Server → CLI)
{ "id": "uuid", "ok": true, "data": { "name": "Dawson" } }

// Error
{ "id": "uuid", "ok": false, "error": "Unknown command: foo" }
```

## License

MIT
