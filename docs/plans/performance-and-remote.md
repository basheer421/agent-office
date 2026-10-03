# Performance, remote access, and where this could go (notes, 2026-10-03)

Pick-up doc. A new Pi session in this repo can start from here: "read docs/plans/performance-and-remote.md".

## 1. Why the office eats CPU/GPU while idle

Measured on Bachir's MacBook (2026-10-03), office started on this repo, nobody connected:

| Process | CPU idle | RSS |
|---|---|---|
| server `node bin/agent-office.js` | 0.0–0.1 % | ~117 MB |
| `agent-office-ptys` (terminal host) | 0.0 % | ~60 MB |

**The server isn't the problem. The cost is the browser tab**, and it's built into the client:

| Cause | Where | Effect |
|---|---|---|
| Frame loop never throttles: `requestAnimationFrame` every frame, always | `src/client/core/loop.ts` `frameLoop`, `src/client/main.ts:190,229` | 60–120 fps (ProMotion) even when nothing moves. Browsers only pause rAF when the tab is *hidden*, not when the window is just behind another one or unfocused |
| Outline effect renders the scene twice per frame | `src/client/core/scene.ts:59` (`OutlineEffect`) | ~2× GPU per frame |
| Retina pixel ratio up to 2 | `scene.ts:55` `setPixelRatio(min(dpr, 2))` | 4× the pixels on a MacBook screen |
| Every in-world screen/terminal is a canvas texture re-uploaded to the GPU | ~144 `CanvasTexture` / `needsUpdate = true` sites in `src/client` | Desk monitors keep updating even when you're on another floor or looking away |
| City, cars, sky, weather, holiday props, dog… all tick every frame | tick phases in `loop.ts` | CPU per frame scales with features, not with what's on screen |
| No visibility handling beyond sound | only `sound/core.ts` listens to `visibilitychange` | — |

### Measured: idle office, 10 s (issue #7, 2026-10-03)

Built from `main` after #20/#21, headless Chromium on ANGLE Metal (Apple M5), 1400×900, nobody touching anything, read with the `?profile` overlay (`features/profiler/`) and `window.__renderStats()`. Each figure is the mean of ten 1 s windows.

| | Office (base map) | Space station |
|---|---|---|
| Frames run | 30 fps (battery/focus cap) | 19 fps (idle throttle drops to 10 fps 20 s in) |
| JS per frame, all phases | 9.5 ms | 9.9 ms |
| Draw calls / triangles | 2 377 / 566 k | 727 / 103 k |
| Textures on the GPU | 67 | 102 |
| Texture uploads | **477 /s** | 0 /s |

Top phases, ms per frame:

| Phase | Office | Station | What's in it |
|---|---|---|---|
| `render` | 5.84 | 5.98 | `effect.render` (scene + outline pass + hands): CPU-side submit of the draw calls |
| `aim` | 3.19 | 2.91 | `input/pointer.ts` raycast for what you look at, every frame, even standing still |
| `env` | 0.22 | 0.69 | sky, scenic cull, holiday props |
| everything else | < 0.1 each | < 0.1 each | |

Takeaways: (1) `aim` is a third of the JS frame for nothing: skip the raycast when the camera and pointer haven't moved. (2) The office uploads ~16 textures a frame at 30 fps: in-world screens re-uploading unchanged canvases (item 4 below) is real, the station has none. (3) 2.4 k draw calls on the base map is what `render` pays for; merging/instancing the static building is the next lever after that. GPU frame time wasn't measured here (these are CPU-side numbers); the Performance panel on a real tab is the way to read it.

### Measured: live worker screens, 8 busy workers (issue #13, 2026-10-03)

Same machine and headless Chromium as above, 1400×900, `?profile` + a WebSocket byte counter in the page. Eight shell workers each printing a log line every 100 ms; standing 7 m back from the desks, with 4 of the 8 laptops in view. Means of ten 1 s windows; WS figures count only `screen` frames.

| | Before (`main`) | After |
|---|---|---|
| WS `screen` bytes per client, 4 of 8 laptops in view | 77.9 KB/s | **38.9 KB/s** |
| Same, standing at one desk (2 in view) | 76.0 KB/s | **19.5 KB/s** |
| Same, tab hidden | ~78 KB/s (kept arriving) | **0 KB/s** (and 43.7 KB/s again once visible) |
| Raw socket, 2 of 8 watched / none (server side) | 86.6 KB/s, 32 frames/s | 21.8 KB/s, 8 frames/s / 0 |
| fps (30 fps cap) | 29.9 | 29.9 |
| JS per frame / `render` phase | 10.4 ms / 6.65 ms | 10.4 ms / 6.7 ms (noise) |

What changed: the page tells the office which laptops it can see (`screens.watch`, from `features/workers/screens.ts`, every 0.5 s and on `visibilitychange`), and `office/screens.ts` sends only those; one that comes back into view gets a full frame. A page that never says (`/lite`) still gets every screen. The laptop canvas drops mipmaps at full size (within ~3 m) and is painted at 512/256 wide, with cheap mipmaps, further off: dropping mipmaps outright made far screens shimmer (checked by screenshot), so the far tiers keep them. CPU per frame didn't move in these runs: the mip-chain rebuild is driver/GPU work that the CPU-side `?profile` numbers don't see, and the bandwidth is the measurable win.

### Optimisations, cheapest first

| # | Change | Gain | Effort |
|---|---|---|---|
| 1 | **Idle throttle**: when no input for N s and nothing animating that matters, drop to 10 fps; on `blur` drop to 2–5 fps; on `visibilitychange` hidden stop | Biggest single win | S |
| 2 | **FPS cap** setting (30 / 60 / display), default 30 on battery (`navigator.getBattery`) | ~half on 120 Hz | S |
| 3 | **Quality setting**: pixel ratio 1, outline off | 2–4× GPU | S |
| 4 | Screens/terminals: update a texture only when its content changed **and** it's in the camera frustum and within distance; other floors never | Removes most texture uploads | M |
| 5 | **"Lite world" toggle**: no city/cars/weather/holiday; the building only | CPU per frame | M |
| 6 | ~~Profile properly~~ done (#7): numbers above; `?profile` shows them live | Turns guesses into numbers | done |
| 7 | `/lite` already exists (non-3D view): check how far it goes as the "daily driver" view | Maybe zero work | S |

Rule from `AGENTS.md`: each of these is its own module through the registries (Settings entry + tick-phase gate), never in `main.ts`.

## 2. Using it from another PC or the phone (Headscale tailnet)

Running now (started 2026-10-03 by Pi as background task `agent-office self`):

```
cd ~/code/private/agent-office && node bin/agent-office.js ~/code/private/agent-office \
  --host 100.64.0.31 --port 4600 --password "$(cat ~/.agent-office-pw)" --agent pi --self-signed --no-open
```

| Question | Answer |
|---|---|
| URL | `https://100.64.0.31:4600` from any device on the tailnet (Mac included) |
| Password | `~/.agent-office-pw` on the Mac (mode 600) |
| Phone | Tailscale app logged into Headscale → open the URL → accept the self-signed cert warning |
| Why `--self-signed` | Voice and screen share need HTTPS. Self-signed works but every device warns once |
| Why bound to the tailnet IP | Only tailnet devices can reach it; not the café Wi-Fi |
| Why not `tailscale serve` | Its HTTPS certs come from Tailscale's control plane; Headscale likely doesn't issue them. Untested |
| Proper HTTPS later | Put it behind the internal ingress as `office.tail.g137.internal` (cert from the internal CA), or `--tls-cert/--tls-key` with a cert for the Mac's MagicDNS name |
| Mac asleep = office gone | It runs on the Mac. For always-on, move it to a VM (see fork-architecture.md, multiplayer) |
| Safety | Anyone with the password runs commands as `bammar` on this Mac. Treat it like SSH |

## 3. "Should this even be a browser app?"

Bachir's idea: same concept (agents as people in a space, live terminals), but its own program or another engine.

| Option | For | Against |
|---|---|---|
| Keep browser, fix §1 | Phone/other PC for free, all upstream features keep coming, smallest work | Browser WebGL is never as cheap as native |
| Wrap in Tauri/Electron | Native window, can pause when minimised, tray icon | Still WebGL inside; Electron adds RAM. Loses phone unless the server stays |
| Native client (Godot / Bevy) talking to the **same server protocol** (`src/shared/protocol/`) | Real perf control, render only what changed, own art direction | Rebuild the whole client; drifts from upstream; phone needs its own build |
| Minecraft (mod/plugin) | Fun, multiplayer solved | Terminals in Minecraft are awkward, heavy client, Java modding, not a work tool |

**Recommendation:** fix §1 first (items 1–3 are a day). The server is already a clean protocol, so a different client later stays possible without throwing anything away. Decide on a native client only if a throttled browser is still too heavy.

## 4. Working on agent-office from inside agent-office

- The office runs on `~/code/private/agent-office` (main checkout, fork `basheer421/agent-office`).
- Hire a worker on that floor → it gets its own worktree + branch, runs `pi` in a shared terminal.
- Workers follow `AGENTS.md`: PR to the fork, `npm run typecheck && npm test && npm run build`.
- **O** opens the PR on the fork (GitHub, works today), the PR board shows it, merging rings the gong.
- The running office is built from `main`; merged changes need a restart (`npm run build` + restart the background task) to show up.
- Fork plan progress: `docs/plans/EXECUTION.md` §3 (P1a = PR #2, waiting for merge).
