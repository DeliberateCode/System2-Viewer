import type Database from 'better-sqlite3';
import type { Migration } from '../migration-runner.js';

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

export const migration002: Migration = {
  version: 2,
  name: 'add-embeddings-table',
  up(db: Database.Database): void {
    db.exec(EMBEDDINGS_DDL);
  },
};
