import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sha = path => createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

/** A version-based advisory may be locally mitigated only by these reviewed exact patches. */
export function verifyDependencyBackports({ projectRoot = root, runRegression = true } = {}) {
  const specs = [
    ['GHSA-vfj7-8cjw-p6xm', 'braces', '3.0.3', ['lib/constants.js', 'lib/parse.js', 'lib/compile.js', 'lib/expand.js', 'lib/stringify.js']],
    ['GHSA-hp3w-g68c-fv3c', 'sprintf-js', '1.0.3', ['src/sprintf.js', 'dist/sprintf.min.js']],
  ];
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'patches/security-backports.json'), 'utf8'));
  const workspace = readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8');
  const verified = new Map();
  for (const [id, name, version, requiredFiles] of specs) {
    const spec = manifest[id];
    const patch = `patches/${name}@${version}.patch`;
    if (!spec || spec.name !== name || spec.version !== version || spec.patch !== patch
        || !spec.files || JSON.stringify(Object.keys(spec.files).sort()) !== JSON.stringify([...requiredFiles].sort())
        || !workspace.includes(`${name}@${version}: ${patch}`)
        || sha(join(projectRoot, patch)) !== spec.sha256) {
      throw new Error(`Unverified security patch registration: ${id}`);
    }
    const packageRoot = dirname(require.resolve(`${name}/package.json`));
    const installed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    if (installed.version !== version || !Object.keys(spec.files).length) {
      throw new Error(`Unexpected patched dependency version: ${name}`);
    }
    for (const [file, digest] of Object.entries(spec.files)) {
      if (sha(join(packageRoot, file)) !== digest) {
        throw new Error(`Security patch is not applied to installed file: ${name}/${file}`);
      }
    }
    verified.set(id, name);
  }
  if (runRegression) {
    const regression = spawnSync(process.execPath, ['--test', join(projectRoot, 'scripts/dependency-security.test.mjs')], {
      cwd: projectRoot, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
    });
    if (regression.error || regression.status !== 0) {
      throw new Error(`Security backport regression failed: ${regression.error?.message || regression.stderr || regression.stdout}`);
    }
  }
  return verified;
}
