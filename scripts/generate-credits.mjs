import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'asset-manifest.json'), 'utf8'));
const assets = manifest.assets.filter(asset => ['used', 'downloaded-and-used'].includes(asset.status));
const fonts = [
  { name: 'DM Sans', author: 'The DM Sans Project Authors', copyright: 'Copyright 2014 The DM Sans Project Authors', sourceUrl: 'https://github.com/googlefonts/dm-fonts', license: 'SIL Open Font License 1.1', licenseUrl: 'https://openfontlicense.org/', localLicense: 'public/fonts/dm-sans-OFL.txt', publicLicense: '/fonts/dm-sans-OFL.txt' },
  { name: 'Instrument Serif', author: 'The Instrument Serif Project Authors', copyright: 'Copyright 2022 The Instrument Serif Project Authors', sourceUrl: 'https://github.com/Instrument/instrument-serif', license: 'SIL Open Font License 1.1', licenseUrl: 'https://openfontlicense.org/', localLicense: 'public/fonts/instrument-serif-OFL.txt', publicLicense: '/fonts/instrument-serif-OFL.txt' },
];
for (const asset of assets) {
  if (!asset.localPath) continue;
  const data = await readFile(resolve(root, asset.localPath));
  const hash = createHash('sha256').update(data).digest('hex');
  if (asset.byteLength !== data.byteLength || asset.sha256 !== hash) throw new Error(`Asset integrity mismatch: ${asset.id}`);
  if (asset.kind === 'vehicle-glb' && data.toString('ascii', 0, 4) !== 'glTF') throw new Error(`Not an actual GLB: ${asset.id}`);
}

const lines = ['# FOCUS DRIVE — Credits', '', '> Generated from asset-manifest.json by node scripts/generate-credits.mjs.', '', '## Assets actually included', ''];
for (const asset of assets) {
  lines.push(`### ${asset.name}`, '', `- Creator: ${asset.author}.`);
  if (asset.copyright) lines.push(`- ${asset.copyright}.`);
  if (asset.sourceUrl) lines.push(`- Source: [original asset](${asset.sourceUrl}).`);
  lines.push(`- License: ${asset.licenseUrl ? `[${asset.license}](${asset.licenseUrl})` : asset.license}.`);
  if (asset.localPath) lines.push(`- Included file: [${asset.localPath.split('/').at(-1)}](${asset.localPath}).`);
  lines.push(`- Changes: ${asset.changes}`, '');
  for (const notice of asset.notices ?? []) lines.push(`  ${notice}`, '');
}
lines.push('## Download attempts — not included', '');
for (const attempt of manifest.attempts ?? []) {
  lines.push(`- [${attempt.name}](${attempt.sourceUrl}) by ${attempt.author}: page listed ${attempt.pageLicenseVerified}; ${attempt.outcome} Substitute: ${attempt.substitute}.`, '');
}
lines.push('## Typography', '');
for (const font of fonts) lines.push(`- [${font.name}](${font.sourceUrl}) — ${font.copyright}. [${font.license}](${font.localLicense}); included unmodified with its original license notice.`, '');
lines.push('## Engine', '', '[PlayCanvas Engine](https://github.com/playcanvas/engine) is distributed under the [MIT license](https://github.com/playcanvas/engine/blob/main/LICENSE).', '', 'Vehicle appearance is a cosmetic only. Asset authors and Khronos do not endorse this project.', '');
await writeFile(resolve(root, 'CREDITS.md'), lines.join('\n'));
const publicCredits = {
  generatedFrom: 'asset-manifest.json',
  verifiedAt: manifest.verifiedAt,
  assets: assets.map(({ id, name, author, copyright, sourceUrl, license, licenseUrl, changes, notices }) => ({ id, name, author, copyright, sourceUrl, license, licenseUrl, changes, notices })),
  downloadAttempts: manifest.attempts,
  fonts,
  engine: { name: 'PlayCanvas Engine', license: 'MIT', sourceUrl: 'https://github.com/playcanvas/engine', licenseUrl: 'https://github.com/playcanvas/engine/blob/main/LICENSE' },
};
await mkdir(resolve(root, 'public/assets'), { recursive: true });
await writeFile(resolve(root, 'public/assets/credits.json'), `${JSON.stringify(publicCredits, null, 2)}\n`);
console.log(`Generated credits for ${assets.length} included assets; local model integrity verified.`);
