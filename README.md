# slidev-addon-obs

A [Slidev](https://sli.dev) addon that switches [OBS Studio](https://obsproject.com) scenes when you navigate between slides. It talks to OBS directly over [obs-websocket](https://github.com/obsproject/obs-websocket), supports protocol **v5** (OBS 28+) and the legacy **v4** plugin, and has no dependencies.

## Installation

```bash
npm install slidev-addon-obs
```

## Usage

Configure the connection in the headmatter and set `obsScene` on the slides that should switch the scene:

```yaml
---
addons:
  - slidev-addon-obs
obs:
  host: 192.168.178.190   # IP or host name, default: localhost
  port: 4455              # default: 4455 (v5) / 4444 (v4)
  password: secret        # optional
  version: 5              # 5 (default) or 4, "v5"/"v4" also work
---

# Welcome

---
obsScene: Q&A
---

# Questions?
```

When a slide with `obsScene` is shown, OBS switches its program scene to it (`SetCurrentProgramScene` in v5, `SetCurrentScene` in v4).

### Delayed switch

`obsSceneDelay` delays the switch, e.g. to let a slide transition or an animation finish first:

```yaml
---
obsScene: Q&A
obsSceneDelay: 2s   # number in ms, or "500ms" / "1.5s"
---
```

The delay only applies when navigating forward. Navigating backwards, jumping back via the overview and the initial load switch immediately. Leaving the slide before the delay has elapsed switches to the scene right away, then the next slide is handled as usual.

### Options

| Option | Default | Description |
|---|---|---|
| `host` | `localhost` | IP or host name of the OBS machine; `host:port` is accepted as well |
| `port` | `4455` / `4444` | obs-websocket port, default depends on `version` |
| `password` | – | obs-websocket password, if authentication is enabled |
| `version` | `5` | Protocol version: `5` (OBS 28+) or `4` (obs-websocket 4.x plugin) |
| `url` | – | Full WebSocket URL, overrides `host`/`port`. A path such as `/obs` is resolved against the Slidev server (see below) |
| `inherit` | `true` | Slides without `obsScene` keep the scene of the previous slide with `obsScene`. Navigating backwards therefore restores the right scene. With `false`, only slides with `obsScene` switch |
| `trigger` | `all` | Windows that switch scenes: `all`, `presenter` or `play` |
| `enabled` | `true` | Set to `false` to turn the addon off without removing the config |

The headmatter is also the frontmatter of the first slide, so `obsScene` in the headmatter applies to the first slide.

### Behavior

- The connection is opened as soon as the presentation or presenter view is loaded, so the first switch is instant.
- A scene is only sent when it changes. If OBS is not reachable yet, the latest scene is sent once the connection is up.
- Lost connections are re-established automatically (1 s, doubling up to 10 s). A wrong password stops the retries.
- Overview, print/export, embedded previews and the notes view never switch scenes.
- With `trigger: all`, the presenter view and the audience window both send the switch. If you always present with the presenter view, `trigger: presenter` keeps it to a single connection.
- Errors (unreachable OBS, wrong password, unknown scene) are logged to the browser console with the prefix `[slidev-addon-obs]`.

## Network notes

WebSockets are not subject to CORS, and obs-websocket does not check the origin, so the browser can connect directly to OBS. Two cases need care:

- **HTTPS:** A deck served via HTTPS (e.g. a deployed build) must not open `ws://` connections (mixed content). Present from the local dev server (`http://localhost`) or put OBS behind a `wss://` proxy.
- **Proxy:** To route the connection through the Slidev dev server, set `url: /obs` and add a WebSocket proxy to `vite.config.ts`:

  ```ts
  import { defineConfig } from 'vite'

  export default defineConfig({
    server: {
      proxy: {
        '/obs': { target: 'ws://192.168.178.190:4455', ws: true, rewrite: path => path.replace(/^\/obs/, '') },
      },
    },
  })
  ```

## Security

The headmatter ends up in the client bundle. A password in `obs.password` is visible to everybody who can open the deck, including a deployed build. Use a dedicated obs-websocket password, or set `enabled: false` before deploying publicly.

## License

MIT
