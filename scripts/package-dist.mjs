import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const RELEASES_DIR = path.join(ROOT_DIR, 'releases');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Comando fallido (${command}) con codigo ${code ?? 'desconocido'}.`));
    });
  });
}

try {
  await access(path.join(DIST_DIR, 'manifest.json'), constants.F_OK);
} catch {
  throw new Error('No existe dist/manifest.json. Ejecuta primero: npm run build:dist');
}

const manifestRaw = await readFile(path.join(DIST_DIR, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);
const version = String(manifest.version || '0.0.0').trim() || '0.0.0';
const safeVersion = version.replace(/[^a-zA-Z0-9._-]+/g, '-');
const zipFilename = `greene-v${safeVersion}.zip`;
const zipPath = path.join(RELEASES_DIR, zipFilename);

await mkdir(RELEASES_DIR, {
  recursive: true
});

await rm(zipPath, {
  force: true
});

if (process.platform === 'win32') {
  const psCommand = `Compress-Archive -Path '${DIST_DIR}\\*' -DestinationPath '${zipPath}' -Force`;
  await runCommand('powershell', ['-NoProfile', '-Command', psCommand]);
} else {
  await runCommand('zip', ['-r', '-q', zipPath, '.'], {
    cwd: DIST_DIR
  });
}

console.log(`[dist] package ready: ${zipPath}`);
