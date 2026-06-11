import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from './migration-runner.js';
import { ReadHandleImpl, EmptyReadHandle } from './read-handle.js';
import { SnapshotTxnImpl } from './snapshot-txn.js';
import type { ReadHandle } from './read-handle.js';
import type { SnapshotTxn } from './snapshot-txn.js';
import type { RevisionId } from './types.js';

/** SQLite PRAGMA tuning options passed through from config. */
export interface SqlitePragmaOpts {
  pageSize?: number;
  cacheSize?: number;
  mmapSize?: number;
  busyTimeout?: number;
}

export class ModelStore {
  private db: Database.Database | null;
  private readonly dataDir: string;
  private readonly sqliteOpts: SqlitePragmaOpts;
  private writerLeaseHeld = false;

  private constructor(db: Database.Database | null, dataDir: string, sqliteOpts: SqlitePragmaOpts) {
    this.db = db;
    this.dataDir = dataDir;
    this.sqliteOpts = sqliteOpts;
  }

  /**
   * Configures a new database connection with standard and custom PRAGMAs.
   *
   * Order matters: page_size must be set BEFORE journal_mode = WAL
   * because WAL writes to the database and locks in the page size.
   * cache_size and mmap_size are session-scoped and can be set any time.
   */
  private static configureConnection(db: Database.Database, opts: SqlitePragmaOpts): void {
    // page_size must come first -- it only takes effect on a fresh database
    // before any writes (including the WAL journal switch).
    if (opts.pageSize != null) {
      db.pragma(`page_size = ${opts.pageSize}`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (opts.cacheSize != null) {
      db.pragma(`cache_size = ${opts.cacheSize}`);
    }
    if (opts.mmapSize != null) {
      db.pragma(`mmap_size = ${opts.mmapSize}`);
    }
    // busy_timeout: default 5000ms when not configured
    const timeout = opts.busyTimeout ?? 5000;
    db.pragma(`busy_timeout = ${timeout}`);
  }

  /**
   * Ensures the database is created, migrated, and available.
   * Called lazily on first write when opened with createIfMissing=false.
   */
  private ensureDb(): Database.Database {
    if (this.db) return this.db;
    mkdirSync(this.dataDir, { recursive: true });
    const dbPath = join(this.dataDir, 'model.sqlite');
    const db = new Database(dbPath);
    ModelStore.configureConnection(db, this.sqliteOpts);
    runMigrations(db);
    this.db = db;
    return db;
  }

  /**
   * Opens or creates the ModelStore.
   *
   * @param dataDir - Path to the data directory
   * @param opts.createIfMissing - When true (default), eagerly creates the
   *   directory and database file. When false, defers creation to the first
   *   write operation; read operations return empty results if the database
   *   does not exist.
   * @param opts.sqliteConfig - Optional SQLite PRAGMA tuning values
   *   (pageSize, cacheSize, mmapSize, busyTimeout).
   */
  static open(dataDir: string, opts?: { createIfMissing?: boolean; sqliteConfig?: SqlitePragmaOpts }): ModelStore {
    const createIfMissing = opts?.createIfMissing ?? true;
    const sqliteOpts: SqlitePragmaOpts = opts?.sqliteConfig ?? {};

    if (!createIfMissing) {
      const dbPath = join(dataDir, 'model.sqlite');
      if (existsSync(dbPath)) {
        const db = new Database(dbPath);
        ModelStore.configureConnection(db, sqliteOpts);
        runMigrations(db);
        return new ModelStore(db, dataDir, sqliteOpts);
      }
      return new ModelStore(null, dataDir, sqliteOpts);
    }

    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'model.sqlite');
    const db = new Database(dbPath);
    ModelStore.configureConnection(db, sqliteOpts);
    runMigrations(db);
    return new ModelStore(db, dataDir, sqliteOpts);
  }

  beginSnapshot(rev: RevisionId): SnapshotTxn {
    if (this.writerLeaseHeld) {
      throw new Error('Single-writer lease violation: a SnapshotTxn is already open');
    }
    const db = this.ensureDb();
    this.writerLeaseHeld = true;
    const releaseLease = () => {
      this.writerLeaseHeld = false;
    };
    return new SnapshotTxnImpl(db, releaseLease);
  }

  read(rev?: RevisionId): ReadHandle {
    if (!this.db) {
      return new EmptyReadHandle();
    }
    return new ReadHandleImpl(this.db, rev);
  }

  /**
   * Returns true if the underlying database connection is available.
   */
  get dbAvailable(): boolean {
    return this.db !== null;
  }

  /**
   * Registers a kind in the kind_registry table (INSERT OR IGNORE).
   * Used for seeding custom claim types from config at engine creation.
   */
  registerKind(kind: string, category: string): void {
    const db = this.ensureDb();
    db
      .prepare(
        'INSERT OR IGNORE INTO kind_registry (kind, category, mvp_emitted) VALUES (?, ?, 0)',
      )
      .run(kind, category);
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
