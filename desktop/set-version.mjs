#!/usr/bin/env node
// Writes the build's version into desktop/src-tauri/tauri.conf.json.
// CI only: git keeps 0.0.0, and a workflow run sets YY.M.RUN (or the tag's
// version) in its own checkout before tauri build. The version must fit an
// MSI (major and minor up to 255, patch up to 65535).
//
//   node desktop/set-version.mjs 26.11.37
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2] || '';
const m = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,5})$/.exec(version);
if (!m || +m[1] > 255 || +m[2] > 255 || +m[3] > 65535) {
    console.error(`set-version: "${version}" is not MAJOR.MINOR.PATCH within 255.255.65535`);
    process.exit(1);
}
const file = join(dirname(fileURLToPath(import.meta.url)), 'src-tauri', 'tauri.conf.json');
const conf = JSON.parse(readFileSync(file, 'utf8'));
conf.version = version;
writeFileSync(file, JSON.stringify(conf, null, 2) + '\n');
console.log(`set-version: ${file} is now ${version}`);
