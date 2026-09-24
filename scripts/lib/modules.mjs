/**
 * Shared facts and helpers for the DeepSeek Harness Windows packaging scripts.
 *
 * The layout below is the contract between the staging script, the smoke test,
 * the launchers, and the Inno Setup script: every one of them resolves paths
 * from these constants so a layout change is a one-file change.
 *
 * @module dsh-windows-installer/lib
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/** Repository root (the directory holding package.json). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Node major version whose bundled `node:sqlite` the web profile expects. */
export const MIN_NODE_MAJOR = 22;

/** Fallback distribution facts, overridden by `package.json` and env/flags. */
const FALLBACK = {
  appName: 'DeepSeek Harness',
  dshPackage: '@deepseek-ai/dsh',
  dshVersion: '0.1.5-rc.3',
  nodeVersion: '24.21.0',
  arch: 'x64',
  distRoot: 'build',
  portableDir: 'build/portable'
};

/** Distribution facts from `package.json`'s `dsh.dist` block, with env overrides. */
export function loadConfig() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const dist = { ...FALLBACK, ...(manifest.dsh?.dist ?? {}) };
  const arch = process.env.DSH_ARCH ?? dist.arch;
  const distRoot = resolve(REPO_ROOT, process.env.DSH_DIST_DIR ?? dist.distRoot);
  const portableDir = resolve(REPO_ROOT, dist.portableDir);
  return {
    ...dist,
    arch,
    distRoot,
    portableDir,
    dshVersion: process.env.DSH_VERSION ?? dist.dshVersion,
    nodeVersion: process.env.NODE_VERSION ?? dist.nodeVersion,
    npmRegistry: process.env.NPM_REGISTRY ?? '',
    nodeMirror: (process.env.NODE_MIRROR ?? 'https://nodejs.org').replace(/\/+$/, ''),
    appRoot: join(portableDir, 'app'),
    appModules: join(portableDir, 'app', 'node_modules'),
    binScript: join(portableDir, 'app', 'node_modules', dist.dshPackage, 'lib', 'bin.js')
  };
}

/**
 * Minimal `--key=value` / `--key value` parser. Bare flags map to `true`, and
 * positional arguments collect under `_`. Unknown keys are returned so the
 * caller can reject them loudly rather than silently ignoring a typo.
 */
export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._ ??= [];
      options._.push(token);
      continue;
    }
    const body = token.slice(2);
    const equals = body.indexOf('=');
    if (equals !== -1) {
      options[body.slice(0, equals)] = body.slice(equals + 1);
    } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
      options[body] = argv[index + 1];
      index += 1;
    } else {
      options[body] = true;
    }
  }
  return options;
}

/** Apply the CLI options that override distribution facts. */
export function applyOptionOverrides(config, options) {
  if (typeof options['dsh-version'] === 'string') config.dshVersion = options['dsh-version'];
  if (typeof options['node-version'] === 'string') config.nodeVersion = options['node-version'];
  if (typeof options.registry === 'string') config.npmRegistry = options.registry;
  if (typeof options['dist-dir'] === 'string') config.distRoot = resolve(REPO_ROOT, options['dist-dir']);
  return config;
}

/** Concise stdout logging without a dependency. */
export function log(message) {
  process.stdout.write(`[dsh-win] ${message}\n`);
}

/** Throwing helper: a failed precondition must abort the build, never warn. */
export function fail(message) {
  throw new Error(message);
}

/** `node.exe` inside the portable app on Windows, `node` elsewhere. */
export function bundledNodePath(config) {
  return join(config.portableDir, process.platform === 'win32' ? 'node.exe' : 'node');
}

/** Windows-only staging is the supported mode; the smoke test runs anywhere. */
export function isWindows(platform = process.platform) {
  return platform === 'win32';
}

/** Verify the Node used to *run* the packaging scripts is new enough. */
export function assertHostNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    fail(`packaging scripts need Node >= ${MIN_NODE_MAJOR} (running ${process.versions.node})`);
  }
}

/** Download `url` to `destination`, with a bounded timeout and retries. */
export async function download(url, destination, { retries = 3, timeoutMs = 600_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      if (response.body === null) throw new Error('empty response body');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
      return destination;
    } catch (error) {
      lastError = error;
      log(`download attempt ${attempt}/${retries} failed: ${url} (${error.message})`);
    } finally {
      clearTimeout(timer);
    }
  }
  fail(`could not download ${url}: ${lastError?.message ?? 'unknown error'}`);
}

/** Fetch a small text resource. */
export async function fetchText(url, { retries = 3, timeoutMs = 60_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      log(`fetch attempt ${attempt}/${retries} failed: ${url} (${error.message})`);
    } finally {
      clearTimeout(timer);
    }
  }
  fail(`could not fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}

/** SHA256 hex digest of a file. */
export async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** Parse an `SHASUMS256.txt` body into a filename -> digest map. */
export function parseShasums(body) {
  const entries = new Map();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) entries.set(match[2].trim(), match[1]);
  }
  return entries;
}

/** Compare two digests without an early exit on the first differing byte. */
export function sameDigest(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Recursively collect files under `root` whose basename matches `predicate`. */
export function walk(root, predicate, found = []) {
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walk(full, predicate, found);
    else if (predicate(entry.name, full)) found.push(full);
  }
  return found;
}

/**
 * Recursively prune entries matching `shouldRemove(name, fullPath, isDirectory)`.
 * @returns the number of removed entries.
 */
export function pruneTree(root, shouldRemove) {
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    const isDirectory = entry.isDirectory();
    if (shouldRemove(entry.name, full, isDirectory)) {
      try {
        rmSync(full, { recursive: true, force: true, maxRetries: 5 });
        removed += 1;
      } catch {
        // A locked or read-only file must not fail the build; it only costs bytes.
      }
      continue;
    }
    if (isDirectory) removed += pruneTree(full, shouldRemove);
  }
  return removed;
}

/**
 * Remove `<package>/src` trees from a staged `node_modules`.
 *
 * The published packages run from `lib/` (or `dist/`), so `src` is audit-only
 * material: ~20 MB per install of TypeScript sources a user never executes.
 * Only a `src` directory that is the direct child of a package directory (the
 * one holding `package.json`) is removed — nested `src` folders are left alone,
 * because a dependency may resolve its runtime files through them.
 * @returns the number of removed directories.
 */
export function prunePackageSources(nodeModulesRoot) {
  if (!existsSync(nodeModulesRoot)) return 0;
  let removed = 0;
  for (const packageDir of listPackageDirs(nodeModulesRoot)) {
    const srcDir = join(packageDir, 'src');
    if (!existsSync(join(packageDir, 'package.json')) || !existsSync(srcDir)) continue;
    const manifest = readPackageJson(packageDir);
    if (manifest === undefined) continue;
    // Never touch a package whose entry points live under src (source-shipped packages).
    const entryPoints = [
      manifest.main,
      manifest.module,
      manifest.types,
      ...Object.values(manifest.exports ?? {}).map((value) =>
        typeof value === 'string' ? value : value?.default
      )
    ].filter((value) => typeof value === 'string');
    if (entryPoints.some((value) => value.replace(/^\.\//, '').startsWith('src/'))) continue;
    try {
      rmSync(srcDir, { recursive: true, force: true, maxRetries: 5 });
      removed += 1;
    } catch {
      // Locked or read-only: keep the bytes rather than fail the build.
    }
  }
  return removed;
}

/** Every package directory, including scoped ones, directly under `nodeModulesRoot`. */
export function listPackageDirs(nodeModulesRoot) {
  if (!existsSync(nodeModulesRoot)) return [];
  const found = [];
  for (const entry of readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const full = join(nodeModulesRoot, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(full, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) found.push(join(full, scoped.name));
      }
      continue;
    }
    if (entry.name === '.bin' || entry.name === '.cache') continue;
    found.push(full);
  }
  return found;
}


/** Directory size in bytes, best effort. */
export function directorySize(root) {
  if (!existsSync(root)) return 0;
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    try {
      if (entry.isDirectory()) total += directorySize(full);
      else total += statSync(full).size;
    } catch {
      // Race with a concurrent prune; ignore.
    }
  }
  return total;
}

/** Human-readable byte count. */
export function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Probe a directory for write permission. */
export function canWrite(directory) {
  try {
    mkdirSync(directory, { recursive: true });
    const probe = join(directory, `.dsh-write-probe-${process.pid}`);
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The platform-specific optional dependency packages the web profile needs at
 * runtime. A missing entry means the staging ran on the wrong platform (or the
 * registry filter dropped it) — exactly what this build must never ship.
 * @param appModules - the staged `node_modules` directory.
 * @param arch - npm arch name (`x64`, `arm64`).
 */
export function requiredPlatformPackages(appModules, arch) {
  return [
    join(appModules, 'sharp'),
    join(appModules, `@img/sharp-win32-${arch}`),
    join(appModules, 'node-addon-require-builtin'),
    join(appModules, `node-addon-require-builtin-win32-${arch}-msvc`)
  ];
}

/** Follow symlinks and read a package directory's `package.json`. */
export function readPackageJson(packageDir) {
  let target = packageDir;
  try {
    target = realpathSync(packageDir);
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** `npm` (POSIX) or `npm.cmd` (Windows) from the Node installation running us. */
export function npmCommand() {
  if (!isWindows()) return 'npm';
  return join(dirname(process.execPath), 'npm.cmd');
}

/** Require a non-empty string option, or abort with the usage hint. */
export function requireStringOption(value, flag, usage) {
  if (typeof value !== 'string' || value.length === 0) fail(`${flag} needs a value\n\n${usage}`);
  return value;
}
