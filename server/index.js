import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? path.join(root, 'data', 'inkwell.db');
const production = process.env.NODE_ENV === 'production';
// In dev, Vite owns the browser-facing port and proxies /api to API_PORT. In production the
// API serves everything, so honour the conventional PORT used by hosting platforms.
const port = Number((production ? process.env.PORT : process.env.API_PORT) ?? 3001);

const db = openDb(dbPath, { seedDemoDocs: process.env.SEED_DEMO !== '0' });
const app = createApp(db, {
  staticDir: production ? path.join(root, 'dist') : undefined,
  secureCookies: process.env.COOKIE_SECURE === '1',
});

app.listen(port, () => {
  console.log(`Inkwell API listening on http://localhost:${port}  (db: ${dbPath})`);
  if (production) console.log(`Serving built client from ${path.join(root, 'dist')}`);
});
