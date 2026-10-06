import { readFileSync } from 'node:fs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, TAG } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !TAG) {
  throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and TAG are required');
}

const PLATFORM_ASSETS = {
  'windows-x86_64': /_x64-setup\.exe$/,
  'darwin-x86_64': /_x64\.app\.tar\.gz$/,
  'darwin-aarch64': /_aarch64\.app\.tar\.gz$/,
};

const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
};

async function request(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed: ${res.status} ${await res.text()}`);
  return res;
}

// Draft releases are not returned by /releases/tags/:tag, so search the list.
async function findRelease() {
  for (let page = 1; page <= 10; page++) {
    const releases = await (await request(`${api}/releases?per_page=100&page=${page}`)).json();
    const release = releases.find((r) => r.tag_name === TAG);
    if (release) return release;
    if (releases.length < 100) break;
  }
  throw new Error(`No release found for tag ${TAG}`);
}

function changelogNotes() {
  const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${TAG}`);
  if (start === -1) return 'See the assets below to download and install.';
  const end = lines.findIndex((line, i) => i > start && /^## v\d/.test(line));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const release = await findRelease();
const assetUrl = (name) =>
  `https://github.com/${GITHUB_REPOSITORY}/releases/download/${TAG}/${encodeURIComponent(name)}`;

const platforms = {};
for (const [platform, pattern] of Object.entries(PLATFORM_ASSETS)) {
  const bundle = release.assets.find((a) => pattern.test(a.name));
  const sig = bundle && release.assets.find((a) => a.name === `${bundle.name}.sig`);
  if (!bundle || !sig) throw new Error(`Missing updater bundle or signature for ${platform}`);
  const signature = await (
    await request(sig.url, { headers: { Accept: 'application/octet-stream' } })
  ).text();
  platforms[platform] = { signature: signature.trim(), url: assetUrl(bundle.name) };
}

const manifest = {
  version: TAG.replace(/^v/, ''),
  notes: changelogNotes(),
  pub_date: new Date().toISOString(),
  platforms,
};

const existing = release.assets.find((a) => a.name === 'latest.json');
if (existing) await request(existing.url, { method: 'DELETE' });

const uploadUrl = release.upload_url.replace(/\{.*\}$/, '');
await request(`${uploadUrl}?name=latest.json`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(manifest, null, 2),
});

console.log(`Uploaded latest.json for ${TAG}: ${Object.keys(platforms).join(', ')}`);
