import type Database from 'better-sqlite3';
import { SCHEMA_DDL, KIND_REGISTRY_SEED_SQL } from './schema.js';

const CURRENT_SCHEMA_VERSION = 2;

const EMBEDDINGS_DDL = `
CREATE TABLE IF NOT EXISTS embeddings (
  node_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, model_name)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model_name);
`;

export function migrate(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return;
  }

  if (currentVersion === 0) {
    db.exec(SCHEMA_DDL);
    db.exec(KIND_REGISTRY_SEED_SQL);
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    return;
  }

  if (currentVersion < 2) {
    db.exec(EMBEDDINGS_DDL);
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }
}
