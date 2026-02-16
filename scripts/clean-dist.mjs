import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

await rm(DIST_DIR, {
  recursive: true,
  force: true
});

console.log(`[dist] cleaned: ${DIST_DIR}`);
