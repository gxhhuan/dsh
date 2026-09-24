#!/usr/bin/env node
/**
 * Stage a self-contained Windows x64 DeepSeek Harness installation.
 *
 * Output layout (the contract with the launchers, the smoke test, and the Inno
 * Setup script):
 *
 *     build/portable/node.exe            bundled Node runtime
 *     build/portable/app/                npm prefix (npm's hoisted layout)
 *     build/portable/app/node_modules/@deepseek-ai/dsh/lib/bin.js
 *     build/portable/launchers/          dsh.cmd, Web UI shortcut target, diagnostics
 *     build/portable/docs/               user-facing notes copied into the install
 *     build/build-info.json              provenance for the produced installer
 *
 * The script is fail-loud by design: a missing Windows-only optional dependency
 * (the reason this build cannot be produced on macOS) aborts the build here
 * rather than shipping an installer that fails on a user's machine.
 *
 * Usage: node scripts/prepare-portable.mjs [--dsh-version <v>] [--node-version <v>]
 *                                          [--registry <url>] [--dist-dir <dir>]
 *                                          [--no-prune]
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import {
  REPO_ROOT,
  applyOptionOverrides,
  assertHostNode,
  bundledNodePath,
  directorySize,
  download,
  fail,
  fetchText,
  formatBytes,
  isWindows,
  loadConfig,
  log,
  npmCommand,
  parseArgs,
  parseShasums,
  prunePackageSources,
  pruneTree,
  readPackageJson,
  requiredPlatformPackages,
  sameDigest,
  sha256,
  walk
} from './lib/modules.mjs';

/** Files copied verbatim from the repository into `build/portable`. */
const COPY_DIRS = [
  ['launchers', 'launchers'],
  ['docs', 'docs']
];

main().catch((error) => {
  process.stderr.write(`[dsh-win] FAILED: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = applyOptionOverrides(loadConfig(), options);
  assertHostNode();

  if (!isWindows()) {
    fail(
      `this staging step must run on Windows: @deepseek-ai/dsh's native dependencies ship per-platform\n` +
        `      (sharp-win32-${config.arch}, node-addon-require-builtin-win32-${config.arch}-msvc) and npm only\n` +
        `      fetches the variant matching the machine that runs the install. Use the GitHub Actions\n` +
        `      windows-latest workflow, or scripts/build-local.ps1 on a Windows machine.`
    );
  }

  log(`staging ${config.appName} with ${config.dshPackage}@${config.dshVersion}, Node ${config.nodeVersion}, ${config.arch}`);

  mkdirSync(config.distRoot, { recursive: true });
  const nodeArchive = await downloadNode(config);
  const staging = mkdtempSync(join(tmpdir(), 'dsh-node-'));
  try {
    extractZip(nodeArchive, staging, `node-v${config.nodeVersion}-win-${config.arch}`);
    resetPortable(config);
    copyNodeRoot(staging, config.portableDir);
    copyStaticFiles(config);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  installDsh(config);
  verifyStagedDependencies(config);
  if (options['no-prune'] !== true) pruneStagedTree(config);
  writeBuildInfo(config);
  verifyStagedLayout(config);
  verifyNoSecrets(config);

  const appSize = directorySize(config.portableDir);
  log(`staged ${config.portableDir} (${formatBytes(appSize)})`);
  log(`next: node scripts/smoke-test.mjs`);
}

/** Download the Windows Node archive and verify it against the published SHASUMS. */
async function downloadNode(config) {
  const name = `node-v${config.nodeVersion}-win-${config.arch}`;
  const archive = join(config.distRoot, `${name}.zip`);
  if (existsSync(archive)) {
    log(`reusing cached ${basename(archive)}`);
  } else {
    const url = `${config.nodeMirror}/dist/v${config.nodeVersion}/${name}.zip`;
    log(`downloading ${url}`);
    await download(url, archive);
  }

  const shasumsPath = join(config.distRoot, `v${config.nodeVersion}-SHASUMS256.txt`);
  if (!existsSync(shasumsPath)) {
    const body = await fetchText(`${config.nodeMirror}/dist/v${config.nodeVersion}/SHASUMS256.txt`);
    writeFileSync(shasumsPath, body, 'utf8');
  }
  const expected = parseShasums(readFileSync(shasumsPath, 'utf8')).get(`${name}.zip`);
  if (expected === undefined) fail(`SHASUMS256.txt for Node ${config.nodeVersion} has no entry for ${name}.zip`);
  const actual = await sha256(archive);
  if (!sameDigest(expected, actual)) {
    rmSync(archive, { force: true });
    fail(`Node archive checksum mismatch for ${name}.zip\n      expected ${expected}\n      actual   ${actual}`);
  }
  log(`verified Node archive sha256 ${actual}`);
  return archive;
}

/**
 * Extract a zip archive with Node's own inflate, so no `tar`/`Expand-Archive`
 * shell-out (and no PowerShell execution policy) is needed.
 * @param archive - absolute `.zip` path.
 * @param destination - directory that receives the archive contents.
 * @param rootPrefix - the single top-level directory the entries carry.
 */
function extractZip(archive, destination, rootPrefix) {
  const buffer = readFileSync(archive);
  let offset = 0;
  let entries = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    const relative = name.startsWith(`${rootPrefix}/`) ? name.slice(rootPrefix.length + 1) : name;
    if (relative.length > 0 && !relative.endsWith('/')) {
      writeZipEntry(name, relative, method, data, uncompressedSize, destination);
      entries += 1;
    }
    offset = dataStart + compressedSize;
  }
  if (entries === 0) fail(`could not read any entry from ${archive} (unexpected archive layout)`);
  log(`extracted ${entries} files from ${basename(archive)}`);
}

/** Write one inflated zip entry to disk, refusing to escape the destination. */
function writeZipEntry(entryName, relative, method, data, uncompressedSize, destination) {
  const target = join(destination, relative);
  const root = resolve(destination);
  if (!resolve(target).startsWith(root)) fail(`archive entry escapes the destination: ${entryName}`);
  if (entryName.endsWith('/')) {
    mkdirSync(target, { recursive: true });
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  if (method === 0) {
    writeFileSync(target, data);
    return;
  }
  if (method !== 8) fail(`unsupported zip compression method ${method} for ${entryName}`);
  const inflated = inflateRawSync(data);
  if (inflated.length !== uncompressedSize) {
    fail(`size mismatch inflating ${entryName}: ${inflated.length} != ${uncompressedSize}`);
  }
  writeFileSync(target, inflated);
}

/** Recreate `build/portable` from scratch so nothing from a previous run leaks in. */
function resetPortable(config) {
  rmSync(config.portableDir, { recursive: true, force: true });
  mkdirSync(config.portableDir, { recursive: true });
  // `build/portable` is a sibling of the npm prefix; keep `app/` empty for npm.
  mkdirSync(config.appRoot, { recursive: true });
}

/** Move the top-level files and directories of the extracted Node tree into place. */
function copyNodeRoot(staging, portableDir) {
  for (const entry of readdirSync(staging)) {
    const from = join(staging, entry);
    const to = join(portableDir, entry);
    try {
      renameSync(from, to);
    } catch {
      cpSync(from, to, { recursive: true, dereference: true });
    }
  }
  if (!existsSync(join(portableDir, 'node.exe'))) fail('the extracted Node archive contained no node.exe');
}

/** Copy the repository-owned runtime files (launchers and user docs) into the app. */
function copyStaticFiles(config) {
  for (const [from, to] of COPY_DIRS) {
    const source = join(REPO_ROOT, from);
    if (!existsSync(source)) fail(`missing ${from}/ in the repository`);
    cpSync(source, join(config.portableDir, to), { recursive: true });
  }
}

/** Install the published dsh package into the npm prefix, with bounded retries. */
function installDsh(config) {
  writeFileSync(
    join(config.appRoot, 'package.json'),
    `${JSON.stringify({ name: 'dsh-portable-app', private: true }, undefined, 2)}\n`,
    'utf8'
  );
  const args = [
    'install',
    `${config.dshPackage}@${config.dshVersion}`,
    '--prefix',
    config.appRoot,
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    '--loglevel=error'
  ];
  if (config.npmRegistry.length > 0) args.push(`--registry=${config.npmRegistry}`);

  const flutter = isWindows();
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    log(`npm install attempt ${attempt}/3 (${config.dshPackage}@${config.dshVersion})`);
    const result = spawnSync(npmCommand(), args, {
      cwd: config.appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: flutter,
      env: { ...process.env, npm_config_update_notifier: 'false' }
    });
    if (result.status === 0) {
      log(`installed ${config.dshPackage} into ${config.appRoot}`);
      return;
    }
    lastError = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
    log(`npm install failed with status ${result.status ?? 'null'}`);
  }
  fail(`npm install failed after 3 attempts:\n${lastError}`);
}

/** Fail when a platform-specific dependency the Windows runtime needs is absent. */
function verifyStagedDependencies(config) {
  if (!existsSync(config.binScript)) {
    fail(`staged tree has no dsh entry point at ${config.binScript}`);
  }
  const missing = [];
  for (const packageDir of requiredPlatformPackages(config.appModules, config.arch)) {
    const manifest = readPackageJson(packageDir);
    if (manifest === undefined) missing.push(packageDir);
  }
  if (missing.length > 0) {
    fail(
      `staged tree is missing platform packages the Windows runtime needs:\n` +
        missing.map((entry) => `      - ${entry}`).join('\n') +
        `\n      this normally means the staging ran on a non-Windows host, or npm's optional\n` +
        `      dependency for ${process.platform}-${process.arch} could not be fetched.`
    );
  }
  const dshManifest = readPackageJson(join(config.appModules, config.dshPackage));
  if (dshManifest === undefined) fail(`cannot read the installed ${config.dshPackage} manifest`);
  if (dshManifest.version !== config.dshVersion) {
    fail(`expected ${config.dshPackage}@${config.dshVersion} but staged ${dshManifest.version}`);
  }
  log(`verified platform packages and ${config.dshPackage}@${dshManifest.version}`);
}

/** Remove Markdown, source maps, and type declarations from `node_modules`. */
function pruneStagedTree(config) {
  let removed = 0;
  const modulesRoot = config.appModules;
  removed += pruneTree(modulesRoot, (name, fullPath, isDirectory) => {
    if (isDirectory) {
      if (name === '__tests__') return true;
      // A bare `test/` directory that is not itself a package is a dev leftover.
      return name === 'test' && !existsSync(join(fullPath, 'package.json'));
    }
    if (name === 'LICENSE' || name === 'LICENSE.md' || name === 'LICENSE.txt') return true;
    if (name === 'README.i18n.yaml' || name === 'CHANGELOG.md') return true;
    // Markdown, source maps, and type declarations are documentation for Node
    // developers, not for someone installing a desktop app.
    return name.endsWith('.md') || name.endsWith('.map') || name.endsWith('.d.ts');
  });
  // Published packages run from `lib/`; `src/` is audit-only TypeScript that is
  // ~20 MB per install. Pruning with the docs also keeps the installer well
  // inside upload and mirror limits when it is distributed from a Release.
  const sourcesRemoved = prunePackageSources(modulesRoot);
  log(`pruned ${removed} documentation/source-map entries and ${sourcesRemoved} package src/ trees`);
}

/** Write the provenance record carried inside the installer. */
function writeBuildInfo(config) {
  const info = {
    appName: config.appName,
    dshPackage: config.dshPackage,
    dshVersion: config.dshVersion,
    nodeVersion: config.nodeVersion,
    arch: config.arch,
    platform: 'win32',
    builtAt: new Date().toISOString(),
    builtOn: `${process.platform}-${process.arch}`,
    nodeUsedForBuild: process.versions.node,
    repository: process.env.GITHUB_REPOSITORY ?? 'local',
    commit: process.env.GITHUB_SHA ?? '',
    runNumber: process.env.GITHUB_RUN_NUMBER ?? ''
  };
  writeFileSync(join(config.distRoot, 'build-info.json'), `${JSON.stringify(info, undefined, 2)}\n`, 'utf8');
  writeFileSync(
    join(config.portableDir, 'VERSION.txt'),
    `${config.appName} ${config.dshVersion} (Node ${config.nodeVersion}, win32-${config.arch})\nbuilt ${info.builtAt}\n`,
    'utf8'
  );
}

/** Assert the staged tree has everything the installer and launchers expect. */
function verifyStagedLayout(config) {
  const required = [
    bundledNodePath(config),
    config.binScript,
    join(config.portableDir, 'launchers', 'dsh.cmd'),
    join(config.portableDir, 'launchers', 'dsh-web-hidden.vbs'),
    join(config.portableDir, 'docs', 'API-KEY.txt')
  ];
  const missing = required.filter((entry) => !existsSync(entry));
  if (missing.length > 0) fail(`staging is incomplete, missing:\n${missing.map((m) => `      - ${m}`).join('\n')}`);
  const launchers = walk(join(config.portableDir, 'launchers'), () => true);
  log(`staged layout verified (${launchers.length} launcher/doc files, node ${statSync(bundledNodePath(config)).size} bytes)`);
}

/** Refuse to ship anything that looks like a user credential. */
function verifyNoSecrets(config) {
  const credentialFiles = walk(config.portableDir, (name) => name === '.credentials.yaml' || name === '.env');
  if (credentialFiles.length > 0) {
    fail(`refusing to package credential files:\n${credentialFiles.map((f) => `      - ${f}`).join('\n')}`);
  }
  const keyPattern = /\bsk-[A-Za-z0-9_-]{24,}/;
  const textFiles = walk(config.portableDir, (name) => /\.(ya?ml|json|txt|md|js|mjs|cjs|vbs|cmd|ps1)$/i.test(name));
  const hits = [];
  for (const file of textFiles) {
    if (statSync(file).size > 2 * 1024 * 1024) continue;
    if (keyPattern.test(readFileSync(file, 'utf8'))) hits.push(file);
  }
  if (hits.length > 0) fail(`refusing to package files containing an API-key-looking string:\n${hits.map((f) => `      - ${f}`).join('\n')}`);
  log(`no credential files or key-shaped strings found in the staged tree`);
}
