#!/usr/bin/env node
// Installs git hooks into .git/hooks/. Idempotent. Runs from `npm install`
// via the `prepare` script, or manually: `node scripts/install-hooks.js`.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let repoRoot;
try {
  repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
} catch {
  // Not in a git checkout (e.g. installed from tarball). Nothing to do.
  process.exit(0);
}

const hooksDir = path.join(repoRoot, '.git', 'hooks');
if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

const hookPath = path.join(hooksDir, 'pre-commit');
const hookBody = `#!/usr/bin/env bash
# Auto-installed by scripts/install-hooks.js. Edits will be overwritten.
exec node "$(git rev-parse --show-toplevel)/scripts/check-sw-bump.js" --staged
`;

fs.writeFileSync(hookPath, hookBody, { mode: 0o755 });
try { fs.chmodSync(hookPath, 0o755); } catch {}

console.log('Installed pre-commit hook -> .git/hooks/pre-commit');
