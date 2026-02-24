import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const COPY_ENTRIES = [
  'manifest.json',
  'assets',
  'docs',
  'panel',
  'popup',
  'src',
  'LICENSE.md',
  'node_modules/@mozilla/readability/Readability.js',
  'node_modules/marked/lib/marked.esm.js',
  'node_modules/@neondatabase/serverless',
  'node_modules/@orama/orama/dist/browser',
  'node_modules/@xenova/transformers/dist',
  'node_modules/@ricky0123/vad-web/dist',
  'node_modules/onnxruntime-web/dist'
];

async function copyEntry(relativePath) {
  const sourcePath = path.join(ROOT_DIR, relativePath);
  const targetPath = path.join(DIST_DIR, relativePath);

  let sourceStats;
  try {
    sourceStats = await stat(sourcePath);
  } catch {
    throw new Error(`No se encontro la ruta requerida para dist: ${relativePath}`);
  }

  if (sourceStats.isDirectory()) {
    await cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
    return;
  }

  await mkdir(path.dirname(targetPath), {
    recursive: true
  });
  await cp(sourcePath, targetPath, {
    force: true
  });
}

await mkdir(DIST_DIR, {
  recursive: true
});

for (const entry of COPY_ENTRIES) {
  await copyEntry(entry);
  console.log(`[dist] copied: ${entry}`);
}

console.log(`[dist] ready: ${DIST_DIR}`);
