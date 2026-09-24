#!/usr/bin/env node
/**
 * Print the values the Inno Setup compile needs, so no unverified string logic
 * lives inside the `.iss` file (ISPP string semantics cannot be exercised
 * without the compiler; this can).
 *
 *   node scripts/dist-meta.mjs --version 0.1.5-rc.3
 *   -> version=0.1.5-rc.3
 *      fileVersion=0.1.5
 *
 * With no `--version`, the version from `package.json` is used, which keeps the
 * workflow and `build-local.ps1` in agreement by construction.
 *
 * `--github-env` also appends `DSH_VERSION` and `DSH_FILE_VERSION` to the file
 * named by `$GITHUB_ENV`, which is how the workflow consumes them.
 */
import { appendFileSync } from 'node:fs';
import { fail, loadConfig, parseArgs, windowsFileVersion } from './lib/modules.mjs';

const options = parseArgs(process.argv.slice(2));
const config = loadConfig();
const version = typeof options.version === 'string' && options.version.length > 0 ? options.version : config.dshVersion;
const fileVersion = windowsFileVersion(version);

if (options['github-env'] === true) {
  const target = process.env.GITHUB_ENV;
  if (target === undefined || target === '') fail('--github-env needs $GITHUB_ENV to be set');
  appendFileSync(target, `DSH_VERSION=${version}\nDSH_FILE_VERSION=${fileVersion}\n`, 'utf8');
}

process.stdout.write(`version=${version}\nfileVersion=${fileVersion}\n`);
