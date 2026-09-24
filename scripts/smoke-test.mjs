#!/usr/bin/env node
/**
 * Boot the staged portable tree for real and assert it serves the Web UI.
 *
 * This is the build's hard gate: an installer that cannot boot is never built.
 * It exercises exactly what a user's double-click does —
 *
 *   1. the bundled runtime runs the staged dsh entry point,
 *   2. `--profile web` composes from the shipped bundles in a clean DSH_HOME,
 *   3. the authenticated startup URL answers `200` with the Web shell title,
 *   4. the fresh home contains `profiles/web` and no credential material.
 *
 * Run it on Windows (the shipping platform) or on a developer machine. Off
 * Windows the staged `node.exe` cannot execute, so the host's own Node runs the
 * staged app tree instead — that still catches a broken install tree, but the
 * platform-package check in `prepare-portable.mjs` remains the Windows gate.
 *
 * Usage: node scripts/smoke-test.mjs [--port <n>] [--timeout <seconds>]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyOptionOverrides,
  bundledNodePath,
  fail,
  isWindows,
  loadConfig,
  log,
  parseArgs
} from './lib/modules.mjs';

const EXPECTED_TITLE = 'DeepSeek Harness';
const STARTUP_URL = /dsh web:\s*(http:\/\/\S+?\/?\?token=[A-Za-z0-9_-]+)/;

main().catch((error) => {
  process.stderr.write(`[dsh-win] SMOKE FAILED: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = applyOptionOverrides(loadConfig(), options);
  const timeoutMs = Number(options.timeout ?? 120) * 1000;
  const port = options.port === undefined ? 0 : Number(options.port);

  if (!existsSync(config.binScript)) fail(`staged dsh entry point is missing: ${config.binScript}`);

  const runtime = pickRuntime(config);
  log(`runtime: ${runtime.command}${runtime.fallback ? ' (Windows node.exe cannot run on this host; using the host Node)' : ''}`);
  log(`entry:   ${config.binScript}`);

  assertDump(config, runtime);
  await assertWebBoots(config, runtime, port, timeoutMs);

  log('smoke test passed: the staged tree boots and serves the Web UI');
}

/** Choose `node.exe` when this host can execute it, else the host Node. */
function pickRuntime(config) {
  const bundled = bundledNodePath(config);
  if (existsSync(bundled) && isWindows()) return { command: bundled, fallback: false };
  const host = process.execPath;
  if (!existsSync(bundled)) fail(`staged runtime is missing: ${bundled}`);
  return { command: host, fallback: true };
}

/** `--dump-default-config` must compose the profile tree and exit cleanly. */
function assertDump(config, runtime) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-dump-'));
  try {
    const result = spawnSyncBounded(
      runtime.command,
      [config.binScript, '--profile', 'web', '--dump-default-config'],
      { DSH_HOME: home },
      90_000
    );
    if (result.status !== 0) {
      fail(`--dump-default-config exited ${result.status}\n${result.stderr || result.stdout}`);
    }
    if (result.stdout.length < 200) {
      fail(`--dump-default-config produced suspiciously little output (${result.stdout.length} bytes)`);
    }
    log(`--dump-default-config OK (${result.stdout.split('\n').length} lines)`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** Boot `--profile web --no-open` and verify the served shell. */
async function assertWebBoots(config, runtime, port, timeoutMs) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-home-'));
  const args = [config.binScript, '--profile', 'web', '--no-open', '--port', String(port)];
  log(`starting: ${runtime.command} ${args.join(' ')} (DSH_HOME=${home})`);

  const child = spawn(runtime.command, args, {
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let output = '';
  const capture = (chunk) => {
    output += chunk.toString('utf8');
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  try {
    const url = await waitForUrl(child, () => output, timeoutMs);
    log(`startup URL: ${url.replace(/token=.*/, 'token=<redacted>')}`);

    const shell = await fetchShell(url);
    if (shell.status !== 200) fail(`the Web shell answered HTTP ${shell.status}, expected 200`);
    if (!shell.html.includes(`<title>${EXPECTED_TITLE}</title>`)) {
      fail(`the Web shell did not contain <title>${EXPECTED_TITLE}</title>`);
    }
    log(`Web shell answered 200 with the expected title (${shell.html.length} bytes)`);

    const profileDir = join(home, 'profiles', 'web');
    if (!existsSync(join(profileDir, 'package.json'))) {
      fail(`a clean DSH_HOME did not initialize the web profile at ${profileDir}`);
    }
    log(`fresh home initialized ${profileDir}`);

    // The web surface writes its own browser-session grant into the credential
    // store; that is expected. What must never appear is a provider API key, so
    // the check is for key material rather than for the file's existence.
    const credentialsPath = join(home, '.credentials.yaml');
    if (existsSync(credentialsPath)) {
      const credentials = readFileSync(credentialsPath, 'utf8');
      if (credentials.includes('DEEPSEEK_API_KEY') || /\bsk-[A-Za-z0-9_-]{16,}/.test(credentials)) {
        fail(`the smoke run produced provider credential material in ${credentialsPath}`);
      }
      log('credential store contains only the browser-session grant (no provider key)');
    }
  } finally {
    await stopProcessTree(child);
    if (process.env.DSH_KEEP_SMOKE_HOME === '1') log(`kept smoke home: ${home}`);
    else rmSync(home, { recursive: true, force: true });
  }
}

/** Wait for the launcher's authenticated startup line and return the URL. */
function waitForUrl(child, readOutput, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    const poll = setInterval(() => {
      const match = STARTUP_URL.exec(readOutput());
      if (match !== null) {
        finish(resolve, match[1]);
        return;
      }
      if (Date.now() > deadline) {
        finish(reject, new Error(`no startup URL within ${timeoutMs} ms\n${readOutput()}`));
      }
    }, 250);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      fn(value);
    }
    function onError(error) {
      finish(reject, error);
    }
    function onExit(code) {
      finish(reject, new Error(`dsh exited with code ${code} before printing a startup URL\n${readOutput()}`));
    }

    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/** Bounded fetch that fails with a diagnostic instead of hanging. */
async function fetchWithTimeout(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: 'manual', signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The authenticated startup URL hands out a session cookie and redirects to the
 * clean root. Node's `fetch` does not resend that cookie to a different path on
 * its own, so the redirect is followed by hand: read `set-cookie` from the 303,
 * then request the root again with it.
 */
async function fetchShell(url, timeoutMs = 20_000) {
  const first = await fetchWithTimeout(url, timeoutMs);
  if (first.status === 200) return { status: 200, html: await first.text() };
  const cookie = first.headers.getSetCookie?.()[0] ?? first.headers.get('set-cookie');
  if (cookie === null || cookie === undefined) {
    return { status: first.status, html: await first.text() };
  }
  const { origin } = new URL(url);
  const second = await fetchWithTimeout(`${origin}/`, timeoutMs, { cookie });
  return { status: second.status, html: await second.text() };
}

/** Kill the whole process tree: dsh spawns workers that also hold the port. */
async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows()) {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      child.kill();
    }
  } else {
    child.kill('SIGTERM');
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const timer = setTimeout(() => {
    if (!isWindows()) child.kill('SIGKILL');
  }, 5000);
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/** Synchronous bounded spawn; `spawnSync` accepts `timeout` directly. */
function spawnSyncBounded(command, args, extraEnv, timeoutMs) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    windowsHide: true,
    env: { ...process.env, ...extraEnv }
  });
  if (result.error !== undefined && result.status === null) {
    fail(`could not run ${command}: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
