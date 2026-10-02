import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check through npm run test:package.');
const packed = spawnSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
assert.equal(packed.status, 0, packed.stderr);
let results;
try { results = JSON.parse(packed.stdout); }
catch { throw new Error('npm pack did not return the expected JSON manifest.'); }
const files = results[0].files.map(file => file.path).sort();
assert.deepEqual(files, ['CHANGELOG.md', 'LICENSE', 'README.md', 'dist/index.ts', 'package.json'].sort());
const excluded = new Set(['node_modules', '.git', '.validation', 'coverage']);
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const home = homedir();
for (const path of walk(root)) {
  const content = readFileSync(path, 'utf8');
  if (home.length > 4) {
    assert.ok(!content.includes(home) && !content.includes(home.replaceAll('\\', '/')), 'Machine-specific home path found in ' + path);
  }
  assert.doesNotMatch(content, /[A-Za-z]:[\\/]+Users[\\/]+[^\s"'<>]+/, 'Personal Windows path found in ' + path);
  assert.doesNotMatch(content, /sk-[A-Za-z0-9_-]{24,}/, 'Potential credential found in ' + path);
}
console.log(`Package allowlist passed (${files.length} files); repository path/credential-pattern checks passed.`);
