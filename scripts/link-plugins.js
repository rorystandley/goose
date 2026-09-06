import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(process.argv[2] ?? path.join(root, '../goose-plugins'));
const links = [];

// Validate the entire plan before replacing links. Never replace real directories.
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const target = path.join(source, entry.name);
  const manifest = path.join(target, 'package.json');
  if (!fs.existsSync(manifest)) continue;
  const { name } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (!/^@goose-plugins\/[a-z0-9][a-z0-9._-]*$/.test(name)) continue;
  const destination = path.join(root, 'node_modules', name);
  if (links.some(link => link.destination === destination)) {
    throw new Error(`Duplicate plugin package: ${name}`);
  }
  let existing;
  try { existing = fs.lstatSync(destination); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (existing && !existing.isSymbolicLink()) {
    throw new Error(`Cannot replace a real file or directory: ${destination}. Move it aside first.`);
  }
  links.push({ name, target, destination, existing });
}

if (!links.length) throw new Error(`No @goose-plugins packages found in ${source}`);
for (const { name, target, destination, existing } of links) {
  const relative = path.relative(path.dirname(destination), target);
  if (existing && fs.readlinkSync(destination) === relative) {
    console.log(`${name} already linked to ${target}`);
    continue;
  }
  if (existing) fs.unlinkSync(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.symlinkSync(relative, destination, 'dir');
  console.log(`${name} -> ${target}`);
}
console.log('Restart Goose and its scheduler to load the linked plugin code.');
