import type Database from 'better-sqlite3';
import { SCHEMA_DDL, KIND_REGISTRY_SEED_SQL } from '../schema.js';
import type { Migration } from '../migration-runner.js';

export const migration001: Migration = {
  version: 1,
  name: 'initial-schema',
  up(db: Database.Database): void {
    db.exec(SCHEMA_DDL);
    db.exec(KIND_REGISTRY_SEED_SQL);
  },
};
