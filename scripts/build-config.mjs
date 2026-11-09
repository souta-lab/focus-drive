import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
for (const name of ['fidelity-manifest.json', 'reconstruction-profile.json']) {
  const contents = await readFile(new URL(`src/config/${name}`, root), 'utf8');
  JSON.parse(contents);
  await writeFile(new URL(`public/${name}`, root), contents);
}
console.log('Published fidelity and reconstruction profiles.');
