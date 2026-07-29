import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../server/', import.meta.url).pathname;
const files = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules') continue;
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (name.endsWith('.js')) files.push(path);
  }
}

walk(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(`Syntax error: ${relative(root, file)}`);
    console.error(result.stderr || result.stdout);
  }
}
if (failed) process.exit(1);
console.log(`Checked ${files.length} server JavaScript files.`);
