// Deletes the local database so the next server start re-creates it with demo data.
import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? path.join(root, 'data', 'inkwell.db');

for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
console.log(`Removed ${dbPath}. Restart the server to re-seed demo users and documents.`);
