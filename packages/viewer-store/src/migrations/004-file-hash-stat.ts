import type Database from 'better-sqlite3';
import type { Migration } from '../migration-runner.js';

export const migration004: Migration = {
  version: 4,
  name: 'add-file-hash-stat-columns',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE file_hashes ADD COLUMN mtime_ms REAL`);
    db.exec(`ALTER TABLE file_hashes ADD COLUMN size INTEGER`);
  },
};
