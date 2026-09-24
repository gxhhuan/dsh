# Install layout and runtime contract

This document is the contract between the build (`scripts/prepare-portable.mjs`),
the launchers (`launchers/`), the installer (`installer/DeepSeekHarness.iss`),
and the smoke test (`scripts/smoke-test.mjs`). Changing a path here means
changing it in all of those places.

## Installed tree

```
%LOCALAPPDATA%\Programs\DeepSeek Harness\
├─ node.exe                                  bundled Node.js runtime
├─ VERSION.txt                               app + dsh + Node versions
├─ app\                                      npm prefix (npm's hoisted layout)
│  ├─ package.json
│  └─ node_modules\
│     ├─ @deepseek-ai\dsh\lib\bin.js         the dsh launcher entry point
│     ├─ @deepseek-ai\dsh-web-app\           Web profile bundle
│     ├─ @deepseek-ai\dsh-base\              base profile bundle
│     ├─ sharp\ + @img\sharp-win32-x64\      image support (Windows binary)
│     └─ node-addon-require-builtin\ + -win32-x64-msvc\
├─ launchers\
│  ├─ dsh.cmd                                console launcher, forwards every dsh argument
│  ├─ dsh-web-hidden.vbs                     Start Menu / desktop shortcut target
│  └─ dsh-diagnose.ps1                       support script
└─ docs\API-KEY.txt                          user-facing first-run notes
```

Nothing under the install directory is written at runtime. The app never
touches its own folder, so multiple users can share one installation and an
upgrade only replaces program files.

### Why `app\` exists

`dsh` resolves its profile bundles (`@deepseek-ai/dsh-base`,
`@deepseek-ai/dsh-web-app`) with Node's own `require.resolve.paths()` starting
from the directory of `@deepseek-ai\dsh\package.json`. The packages therefore
have to sit in a real `node_modules` chain above that file. `npm install
--prefix <dir>` produces exactly that layout, which is why the staging script
uses the npm prefix instead of copying packages by hand.

### What staging removes

The staged tree is a subset of the published packages: Markdown, source maps,
`.d.ts` files, `LICENSE` copies, and each package's `src/` source directory are
removed (a package whose entry points live under `src/` is left untouched).
This is a distribution-size measure that keeps the installer small for Release
assets and mirrors; the smoke test runs against the pruned tree, so the
trimming is verified on every build rather than assumed.

## User data

```
%USERPROFILE%\.dsh\
├─ .credentials.yaml     API keys and the browser-session grant
├─ settings.yaml         UI settings (theme, font size, ...)
├─ cordis.patch.yml      optional home-level config overlay
├─ profiles\
│  └─ web\               profile manifest + user patch layer (auto-created)
├─ sessions\             conversation history
├─ storages\
└─ logs\                 created by the Start Menu launcher: web-<timestamp>.log
```

`%USERPROFILE%\.dsh` matches what the standard `dsh` CLI uses, so someone who
also installs the CLI shares keys, settings, and session history.

## Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `DSH_HOME` | dsh, both launchers | overrides the data directory (any absolute path) |
| `DSH_PORTABLE` | both launchers | `1` keeps data in `<install>\home` instead of `%USERPROFILE%\.dsh` |
| `DEEPSEEK_API_KEY` | dsh credential lookup | takes precedence over the credentials file |
| `DEEPSEEK_BASE_URL` | dsh deepseek adapter | overrides the API endpoint |
| `HTTPS_PROXY` / `HTTP_PROXY` | dsh http proxy | outbound proxy for API calls |
| `DSH_TELEMETRY_DISABLED` | dsh | any non-empty value disables the telemetry row |

Credential precedence inside dsh is: launch environment, then
`.credentials.yaml`, then a project `.env`, then `%DSH_HOME%\.env`.

## Process and network behaviour

- `dsh --profile web` binds **127.0.0.1 only** — `--host 0.0.0.0` is refused by
  the app itself. Nothing is exposed to the LAN.
- The startup URL carries a per-process token; the browser exchanges it for a
  signed cookie and is redirected to the clean root. The Start Menu launcher
  does not pass `--port`, so the app picks a free port and opens the browser
  itself, which avoids a "probe a port, then bind it" race.
- The console launcher forwards arguments verbatim, so
  `dsh.cmd --profile web --port 8080 --no-open` and
  `dsh.cmd --profile headless "run the tests"` both work.
- The short path (`%~sI`) is substituted when the install path is non-ASCII,
  because `cmd.exe` mangles UTF-8 paths. With 8.3 names disabled the
  substitution is skipped and the plain path is used.

## What the uninstaller does

1. `[UninstallRun]` stops only processes that hold the loopback listener or
   whose command line names our launcher — never a blanket `taskkill node.exe`.
2. Removes the install directory (only files it created).
3. Asks, defaulting to **keep**, whether to delete `%USERPROFILE%\.dsh`.
   A silent uninstall never deletes an API key or session history.
