#!/usr/bin/env node
// Writes desktop/THIRD-PARTY.txt: every Rust crate the desktop app can
// compile in (any target: Windows, macOS, Linux) and every Go module
// topo-server is built from (the app bundles the server, D113), with each
// one's licence and the licence files it ships, so the notices MIT, BSD,
// Apache-2.0 and the rest ask for travel with the app (desktop/stage.sh
// --desktop copies it in; the README points at it).
//
//   node desktop/third-party.mjs          # rewrite the file
//   node desktop/third-party.mjs --check  # exit 1 if it is out of date
//
// Needs cargo and go, with the crates and modules already downloaded (any
// cargo build or cargo fetch, any go build), and works offline. Run it
// after a change to desktop/src-tauri/Cargo.lock or server/go.sum.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'desktop', 'THIRD-PARTY.txt');
const check = process.argv.includes('--check');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 });

// Licence files in a package's folder (top level only, as packages ship them).
const LIC_RE = /^(licen[cs]e|copying|notice|unlicense|copyright)([-._].*)?$/i;
function licenceFiles(dir) {
    if (!dir || !existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => LIC_RE.test(f)).sort()
        .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim() }));
}

// ---- Rust: the resolve graph from the app, without dev-dependencies ----
// The six targets .github/workflows/builds.yml builds (not Android or iOS).
const TARGETS = ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'x86_64-apple-darwin', 'aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'];
const meta = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--offline', '--locked', ...TARGETS.flatMap((t) => ['--filter-platform', t])], join(ROOT, 'desktop', 'src-tauri')));
const pkgById = new Map(meta.packages.map((p) => [p.id, p]));
const nodeById = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const seen = new Set();
const stack = [meta.resolve.root];
while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of (nodeById.get(id) || { deps: [] }).deps) {
        if (d.dep_kinds.every((k) => k.kind === 'dev')) continue;
        stack.push(d.pkg);
    }
}
const crates = [...seen].map((id) => pkgById.get(id)).filter((p) => p && p.source)
    .map((p) => ({ name: p.name, version: p.version, licence: p.license || '(see its files)', url: p.repository || '', authors: p.authors || [], files: licenceFiles(dirname(p.manifest_path)) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

// A crate that ships no licence file: the standard text of the licence it
// names (the first of an OR; every one of an AND), with its authors as the
// copyright line, taken from a crate that does ship it.
const STANDARD = { 'MIT': /^LICEN[CS]E-MIT/i, 'Apache-2.0': /^LICEN[CS]E-APACHE/i, 'MPL-2.0': /^LICEN[CS]E(\.md|\.txt)?$/i };
function standardText(id) {
    const re = STANDARD[id];
    if (!re) return null;
    for (const c of crates) {
        if (id === 'MPL-2.0' && c.licence !== 'MPL-2.0') continue;
        const f = c.files.find((x) => re.test(x.name) && (id !== 'MIT' || /Permission is hereby granted/.test(x.text)) && (id !== 'Apache-2.0' || /Apache License/.test(x.text)));
        if (f) return id === 'MIT' ? f.text.replace(/^[\s\S]*?(Permission is hereby granted)/, '$1') : f.text;
    }
    return null;
}
// BSD-3-Clause has no common file to borrow; its standard wording.
const BSD3 = 'Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.';
const withNotice = (id) => id === 'MIT' || id === 'BSD-3-Clause';
for (const c of crates) {
    if (c.files.length) continue;
    const clean = c.licence.replace(/[()]/g, '');
    // AND: every one. OR (or the old "/"): the first one with a standard text.
    const ids = /\bAND\b/.test(clean) ? clean.split(/\s+AND\s+/).map((x) => x.trim())
        : [clean.split(/\s+OR\s+|\s*\/\s*/).map((x) => x.trim()).find((x) => x === 'BSD-3-Clause' || standardText(x))].filter(Boolean);
    for (const id of ids) {
        const text = id === 'BSD-3-Clause' ? BSD3 : standardText(id);
        if (!text) continue;
        const who = c.authors.length ? c.authors.map((a) => a.replace(/\s*<[^>]*>/, '')).join(', ') : 'the ' + c.name + ' authors';
        c.files.push({ name: id + ' (standard text; the crate ships none)', text: withNotice(id) ? 'Copyright (c) ' + who + '\n\n' + text : text });
    }
}

// ---- Go: the modules topo-server's packages come from ----
const goLines = run('go', ['list', '-deps', '-f', '{{with .Module}}{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}', './cmd/topo-server'], join(ROOT, 'server'))
    .split('\n').filter(Boolean);
const goMods = new Map();
for (const l of goLines) { const [path, version, dir] = l.split('\t'); goMods.set(path, { path, version, dir }); }
function guessGo(text) {
    if (/Permission is hereby granted, free of charge/.test(text)) return 'MIT';
    if (/Apache License[\s\S]*Version 2\.0/.test(text)) return 'Apache-2.0';
    if (/Redistribution and use in source and binary forms/.test(text)) return /Neither the name|names of its contributors/.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
    if (/Mozilla Public License/.test(text)) return 'MPL-2.0';
    return '(see its files)';
}
const mods = [...goMods.values()].map((m) => {
    const files = licenceFiles(m.dir);
    return { name: m.path, version: m.version, licence: files.length ? guessGo(files[0].text) : '(no licence file found)', url: 'https://pkg.go.dev/' + m.path, files };
}).sort((a, b) => a.name.localeCompare(b.name));

// ---- The file: a list, then each distinct licence text once ----
const texts = new Map();   // hash -> { text, users: [] }
const ref = (p) => p.files.map((f) => {
    const h = createHash('sha256').update(f.text).digest('hex').slice(0, 12);
    if (!texts.has(h)) texts.set(h, { text: f.text, name: f.name, users: [] });
    texts.get(h).users.push(`${p.name} ${p.version}`);
    return `[${h}]`;
}).join(' ');
const row = (p) => `${p.name} ${p.version}\n    Licence: ${p.licence}${p.url ? `\n    Source:  ${p.url}` : ''}\n    Texts:   ${ref(p) || '(none shipped by the package)'}`;
const rust = crates.map(row), go = mods.map(row);
const parts = [
    'Topo desktop app: third-party software',
    '======================================',
    '',
    'Topo itself is under the GNU Affero General Public License v3.0 or later',
    '(LICENSE). The desktop app is also built from the Rust crates below, and',
    'it carries topo-server, built from the Go modules below. Each keeps its',
    'own licence; their licence texts follow the lists, each text once, with',
    'the packages that ship it. The fonts and the scripts in vendor/ have',
    'their own notices: fonts/OFL.txt and vendor/README.md.',
    '',
    'Generated by desktop/third-party.mjs from desktop/src-tauri/Cargo.lock',
    'and server/go.mod; do not edit by hand.',
    '',
    `Rust crates (${crates.length})`,
    '-'.repeat(`Rust crates (${crates.length})`.length),
    '', rust.join('\n\n'), '',
    `Go modules in topo-server (${mods.length})`,
    '-'.repeat(`Go modules in topo-server (${mods.length})`.length),
    '', go.join('\n\n'), '',
    'Licence texts',
    '-------------',
];
for (const [h, t] of texts) {
    const users = t.users.length > 6 ? t.users.slice(0, 6).join(', ') + `, and ${t.users.length - 6} more` : t.users.join(', ');
    parts.push('', `[${h}] ${t.name}, shipped by ${users}`, '', t.text, '', '~'.repeat(72));
}
const body = parts.join('\n') + '\n';
if (check) {
    const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (old !== body) { console.error('desktop/THIRD-PARTY.txt is out of date: run node desktop/third-party.mjs'); process.exit(1); }
    console.log(`desktop/THIRD-PARTY.txt is current: ${crates.length} crates, ${mods.length} Go modules, ${texts.size} licence texts.`);
} else {
    writeFileSync(OUT, body);
    console.log(`wrote desktop/THIRD-PARTY.txt: ${crates.length} crates, ${mods.length} Go modules, ${texts.size} licence texts, ${Math.round(body.length / 1024)} KB.`);
}
