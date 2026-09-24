# Optional installer icons (drop files here to enable them)

This build works without any icon assets. To brand the installer and the app
shortcut, put these two files in this directory and they are picked up
automatically by `installer/DeepSeekHarness.iss` and the launchers:

| File | Purpose | Format |
|---|---|---|
| `app.ico` | Installer icon, Add/Remove Programs icon, shortcut icon | multi-size `.ico` (16/32/48/256) |
| `wizard-image.bmp` | Left panel of the setup wizard | `.bmp`, 164x314 (Inno Setup 6) or 135x135 (Inno Setup 7) |

Nothing here is required; absent files simply fall back to the Inno Setup
defaults and the generic executable icon. Do not commit icons you do not have
the rights to redistribute.
