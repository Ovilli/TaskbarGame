# Taskbar Garden

A cozy pixel-art gardening game that lives in your system tray. Click the tray icon, plant a flower, water it, sell to villagers, hide the window again. No ads, no clicker spam, no online services.

- **Cross-platform** Windows, macOS, Linux (Tauri 2)
- **Tiny footprint** native binary, no Chromium runtime, low CPU when hidden
- **Offline-first** all data is stored locally in your OS user data directory
- **Open source** MIT licensed

## Status

Early development. Core gameplay loop is in place: plant, grow in real time while open, harvest, sell to a customer with a wish.

## Install

Pre-built installers will be published on GitHub Releases (`.msi`, `.dmg`, `.deb`, `.AppImage`). For now, build from source.

## Build from source

Requirements:
- [Rust](https://rustup.rs/) 1.77+
- [Node.js](https://nodejs.org/) 20+ and `pnpm` (or `npm`)
- Platform deps: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```sh
pnpm install
pnpm tauri icon src-tauri/icons/source.svg   # one-time: generates platform icons
pnpm tauri dev                                # run in dev mode
pnpm tauri build                              # produce installers in src-tauri/target/release/bundle/
```

If you don't have a source PNG yet, export `src-tauri/icons/source.svg` to a 1024x1024 PNG with any image tool, then run `pnpm tauri icon path/to/source.png`.

## How to play

1. Left-click the tray icon to open the small popup window.
2. **Garden** tab: click an empty plot to plant your selected seed. Wait for it to grow. Click a bloomed flower to harvest it.
3. **Shop** tab: buy more seeds. Pick which seed type you want to plant next. When a customer arrives, sell them the flowers they want for a coin bonus.
4. **Settings** tab: toggle sound and notifications, change window anchor position and size, or reset progress.
5. Click anywhere outside the window or the `_` button to hide. The game pauses when hidden.

## Design notes

- Growth is real-time but only progresses while the window is open (per project decision). Closing the window pauses time.
- The renderer is a single 320x320 canvas drawn at 1Hz - cheap, no animations beyond a small shimmer on bloomed flowers.
- All save data is JSON in `localStorage` inside the Tauri webview's per-app user data directory. Atomic writes via the platform.
- The window is hidden by default on launch and on close. The tray icon is the only persistent UI.
- No network calls. CSP locks scripts and media to local origin.

## Roadmap

- Multi-plot watering minigame
- Seasonal flower variants
- Optional desktop notifications (toggle is in Settings, default off)
- Auto-update via Tauri updater + signed GitHub releases
- Auto-start on login (toggle)
- Trading market - online (off by default, opt-in)

## License

MIT - see [LICENSE](LICENSE).
