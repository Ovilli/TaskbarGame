# Icons

Tauri requires platform icons. Generate them from a single source PNG (1024x1024 recommended):

```
pnpm tauri icon icons/source.png
```

This produces `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` and Android/iOS variants.

`tray.png` should be a 32x32 monochrome PNG (template image on macOS — uses the system bar tint).

Until icons are generated, the build will fail. A placeholder source SVG is included as `source.svg`; export it to `source.png` with any image tool, or replace with your own art.
