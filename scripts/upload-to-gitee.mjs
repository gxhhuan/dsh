#!/usr/bin/env node
/**
 * Publish the built installer to a Gitee release (发行版).
 *
 * Gitee has no hosted Windows runner, so the installer for a Gitee-hosted
 * project is produced by `scripts/build-local.ps1` on a Windows machine and
 * published from here. The script uses the documented Gitee v5 endpoints:
 *
 *   POST /api/v5/repos/{owner}/{repo}/releases
 *   POST /api/v5/repos/{owner}/{repo}/releases/{release_id}/attach_files
 *
 * Gitee release attachments are limited to 100 MB per file and 1 GB per
 * repository (community edition), so the script refuses to upload anything
 * larger up front instead of failing halfway.
 *
 * Usage:
 *   GITEE_TOKEN=<token> node scripts/upload-to-gitee.mjs \
 *     --repo owner/name --tag v0.1.5-rc.3
 *
 * Options:
 *   --repo <owner/name>   Gitee repository (or env GITEE_REPO)
 *   --tag <tag>           release tag, e.g. v0.1.5-rc.3
 *   --name <title>        release title (default: "DeepSeek Harness <version>")
 *   --notes <file>        release notes markdown file (default: dist/RELEASE-NOTES.md if present)
 *   --dist <dir>          directory holding the artifacts (default: dist)
 *   --prerelease          mark the release as a preview (default for -rc/-alpha/-beta tags)
 *   --no-upload           create/verify the release but skip attachment upload
 *   --dry-run             print what would happen; make no network calls
 *
 * Token: create one at https://gitee.com/profile/personal_access_tokens with
 * at least the `projects` scope, then set GITEE_TOKEN (never paste it into a
 * file in this repository).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { REPO_ROOT, fail, formatBytes, log, parseArgs } from './lib/modules.mjs';

/** Gitee's documented per-attachment ceiling for community accounts. */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const API = 'https://gitee.com/api/v5';

main().catch((error) => {
  process.stderr.write(`[dsh-win] UPLOAD FAILED: ${error.message}\n`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.GITEE_TOKEN ?? '';
  const repo = String(options.repo ?? process.env.GITEE_REPO ?? '');
  const dryRun = options['dry-run'] === true;

  if (repo === '') fail('missing --repo owner/name (or GITEE_REPO)');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) fail(`--repo must look like owner/name, got ${JSON.stringify(repo)}`);

  const distDir = resolve(REPO_ROOT, typeof options.dist === 'string' ? options.dist : 'dist');
  if (!existsSync(distDir)) fail(`no ${distDir} directory: run the build first (scripts/build-local.ps1)`);

  const artifacts = readdirSync(distDir)
    .filter((name) => name.endsWith('.exe') || name === 'SHA256SUMS.txt' || name === 'RELEASE-NOTES.md')
    .map((name) => join(distDir, name));
  const installers = artifacts.filter((file) => file.endsWith('.exe'));
  if (installers.length === 0) fail(`no .exe installer in ${distDir}`);

  const tag = String(options.tag ?? deduceTag(installers[0]));
  if (tag === '') fail('missing --tag and the installer name carries no recognizable version');
  const title = typeof options.name === 'string' ? options.name : `DeepSeek Harness ${tag}`;
  // -rc/-alpha/-beta tags are previews by default; --prerelease forces it on.
  const prerelease = options.prerelease === true || /-(rc|alpha|beta)/i.test(tag);
  const skipUpload = options.upload === false || options['no-upload'] === true;
  const notesPath =
    typeof options.notes === 'string'
      ? resolve(REPO_ROOT, options.notes)
      : join(distDir, 'RELEASE-NOTES.md');
  const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : defaultNotes(tag);

  log(`repository : ${repo}`);
  log(`release    : ${tag} (${title})${prerelease ? ' [preview]' : ''}`);
  log(`artifacts  : ${artifacts.map((file) => `${basename(file)} (${formatBytes(statSync(file).size)})`).join(', ')}`);

  checkSizes(artifacts);

  if (dryRun) {
    log('dry run: no request was sent. Would create the release, then POST each attachment.');
    return;
  }
  if (token === '') {
    fail(
      'missing GITEE_TOKEN\n' +
        '      create a personal access token with the `projects` scope at\n' +
        '      https://gitee.com/profile/personal_access_tokens and export it as GITEE_TOKEN'
    );
  }

  const release = await createRelease({ repo, tag, title, notes, prerelease, token });
  log(`release ready: ${release.html_url ?? `id ${release.id}`}`);

  if (skipUpload) {
    log('--no-upload: skipping attachment upload');
    return;
  }

  for (const file of artifacts) {
    const attachment = await attachFile({ repo, releaseId: release.id, file, token });
    log(`uploaded ${basename(file)} -> ${attachment.download_url ?? '(no download url returned)'}`);
  }

  const verified = await fetchRelease({ repo, tag, token });
  const attached = Array.isArray(verified.assets) ? verified.assets.map((asset) => asset.name) : [];
  log(`release now carries: ${attached.length > 0 ? attached.join(', ') : '(no attachments reported)'}`);
  log('done. Share the release page link with your users.');
}

/** Create (or reuse) the release for `tag`. */
async function createRelease({ repo, tag, title, notes, prerelease, token }) {
  const body = new URLSearchParams({
    access_token: token,
    tag_name: tag,
    name: title,
    body: notes,
    target_commitish: 'master',
    prerelease: String(prerelease)
  });
  const response = await fetch(`${API}/repos/${repo}/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await response.text();
  if (response.ok) return JSON.parse(text);

  // 400 "already exists" is recoverable: reuse the existing release.
  if (response.status === 400 || response.status === 409) {
    log(`release ${tag} already exists, reusing it`);
    return fetchRelease({ repo, tag, token });
  }
  fail(`Gitee rejected the release (${response.status}): ${text.slice(0, 500)}`);
}

/** Look up an existing release by tag. */
async function fetchRelease({ repo, tag, token }) {
  const response = await fetch(
    `${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}?access_token=${encodeURIComponent(token)}`
  );
  const text = await response.text();
  if (!response.ok) fail(`could not read release ${tag} (${response.status}): ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

/** Upload one artifact as a release attachment. */
async function attachFile({ repo, releaseId, file, token }) {
  const form = new FormData();
  form.append('access_token', token);
  // Blob keeps this dependency-free on Node >= 20; the size check above keeps
  // the in-memory copy within a fraction of typical headroom.
  form.append('file', new Blob([readFileSync(file)]), basename(file));
  const response = await fetch(`${API}/repos/${repo}/releases/${releaseId}/attach_files`, {
    method: 'POST',
    body: form
  });
  const text = await response.text();
  if (!response.ok) {
    fail(
      `upload of ${basename(file)} failed (${response.status}): ${text.slice(0, 500)}\n` +
        `      upload it by hand at https://gitee.com/${repo}/releases if this is a Gitee API limitation.`
    );
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed;
}

/** Refuse artifacts Gitee cannot accept, before any upload starts. */
function checkSizes(artifacts) {
  for (const file of artifacts) {
    const size = statSync(file).size;
    if (size > MAX_ATTACHMENT_BYTES) {
      fail(
        `${basename(file)} is ${formatBytes(size)}, above Gitee's ${formatBytes(MAX_ATTACHMENT_BYTES)} per-attachment limit.\n` +
          `      Options: re-run the staging step (it prunes src/docs to save ~20 MB), split the payload,\n` +
          `      publish on a platform without the cap, or attach the file by hand in the Gitee UI.`
      );
    }
  }
}

/** Derive a tag from `DeepSeek-Harness-Setup-<version>-x64.exe`. */
function deduceTag(installer) {
  const match = /Setup-(.+)-x64\.exe$/i.exec(basename(installer));
  return match === null ? '' : `v${match[1]}`;
}

/** Fallback release notes when the build did not write any. */
function defaultNotes(tag) {
  return [
    `DeepSeek Harness for Windows x64 — ${tag}`,
    '',
    '- Per-user install, no administrator rights required.',
    '- Configure your own DeepSeek API key on first run: 设置 → 模型 (Settings → Models).',
    '- Verify the download against `SHA256SUMS.txt`.',
    ''
  ].join('\n');
}
