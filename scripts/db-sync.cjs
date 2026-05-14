'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEV_DB = path.join(ROOT, 'prisma', 'dev.db');
const PROD_DB = path.join(process.env.APPDATA || '', 'finances-os', 'database.db');

const direction = process.argv[2];
if (direction !== 'push' && direction !== 'pull') {
  console.error('Usage: node scripts/db-sync.cjs <push|pull>');
  console.error('  push: dev (prisma/dev.db) -> prod (%APPDATA%\\finances-os\\database.db)');
  console.error('  pull: prod (%APPDATA%\\finances-os\\database.db) -> dev (prisma/dev.db)');
  process.exit(1);
}

const src = direction === 'push' ? DEV_DB : PROD_DB;
const dst = direction === 'push' ? PROD_DB : DEV_DB;
const srcLabel = direction === 'push' ? 'DEV' : 'PROD';
const dstLabel = direction === 'push' ? 'PROD' : 'DEV';

if (!fs.existsSync(src)) {
  console.error(`Source ${srcLabel} database not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });

if (fs.existsSync(dst)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${dst}.${stamp}.bak`;
  fs.copyFileSync(dst, backup);
  console.log(`Backed up existing ${dstLabel} db -> ${backup}`);
}

fs.copyFileSync(src, dst);
const bytes = fs.statSync(dst).size;
console.log(`Copied ${srcLabel} -> ${dstLabel} (${bytes.toLocaleString()} bytes)`);
console.log(`  src: ${src}`);
console.log(`  dst: ${dst}`);
