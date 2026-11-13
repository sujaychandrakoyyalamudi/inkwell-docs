import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initDatabase } from '../shared/schema.js';

export { SEED_USERS, transaction } from '../shared/schema.js';

/**
 * Open (or create) the SQLite database, apply the schema and seed demo data.
 * Pass ':memory:' for an ephemeral database (used by tests).
 */
export function openDb(file, { seedDemoDocs = true } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return initDatabase(db, { seedDemoDocs });
}
