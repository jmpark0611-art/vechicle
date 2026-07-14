const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const requiredFiles = [
  'app.json',
  path.join('app', '_layout.tsx'),
  path.join('app', 'role-select.tsx'),
  path.join('app', 'commander-pin.tsx'),
  path.join('app', '(tabs)', '_layout.tsx'),
  path.join('app', '(tabs)', 'index.tsx'),
  path.join('app', '(tabs)', 'explore.tsx'),
  path.join('app', '(tabs)', 'vehicles.tsx'),
  path.join('app', '(tabs)', 'map.tsx'),
  path.join('app', '(tabs)', 'check.tsx'),
];

const ignoredDirs = new Set(['.expo', '.git', 'assets', 'node_modules', 'dist', 'web-build']);
const checkedExtensions = new Set(['.js', '.ts', '.tsx']);
const appCodeConsolePattern = /\bconsole\.(log|warn|error|debug|info)\s*\(/;
const failures = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`${file.replaceAll(path.sep, '/')}: required file is missing`);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walk(path.join(dir, entry.name));
      }
      continue;
    }

    if (!entry.isFile() || !checkedExtensions.has(path.extname(entry.name))) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll(path.sep, '/');
    const content = fs.readFileSync(fullPath, 'utf8');
    if (
      appCodeConsolePattern.test(content) &&
      (relativePath.startsWith('app/') || relativePath.startsWith('components/') || relativePath.startsWith('lib/'))
    ) {
      failures.push(`${relativePath}: remove console output from app code`);
    }
  }
}

walk(root);

const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
if (appJson.expo?.name !== '차량운행시스템') {
  failures.push('app.json: expo.name must be 차량운행시스템');
}

if (failures.length > 0) {
  console.error('source-check failed');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('source-check OK');
