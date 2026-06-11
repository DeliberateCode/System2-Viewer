/**
 * In-memory cross-file symbol registry.
 *
 * Built during the extraction pass and consumed during import resolution.
 * Not persisted — ephemeral per indexing run.
 */

export interface GlobalSymbolEntry {
  nodeId: string;
  filePath: string;
  exported: boolean;
  language: string;
  kind: string;
}

export class GlobalSymbolMap {
  private readonly entries = new Map<string, GlobalSymbolEntry[]>();
  private count = 0;

  register(symbolName: string, entry: GlobalSymbolEntry): void {
    let list = this.entries.get(symbolName);
    if (!list) {
      list = [];
      this.entries.set(symbolName, list);
    }
    list.push(entry);
    this.count++;
  }

  lookup(name: string): GlobalSymbolEntry[] {
    const list = this.entries.get(name);
    if (!list) return [];
    return list.slice();
  }

  clear(): void {
    this.entries.clear();
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
