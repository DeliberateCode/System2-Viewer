/**
 * Base model with common properties.
 */

export interface ModelMetadata {
  version: number;
  lastModifiedBy: string;
  tags: string[];
}

export abstract class BaseModel {
  public readonly id: string;
  public readonly createdAt: Date;
  public updatedAt: Date;
  public metadata: ModelMetadata;

  constructor(id: string, metadata?: Partial<ModelMetadata>) {
    this.id = id;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.metadata = {
      version: metadata?.version ?? 1,
      lastModifiedBy: metadata?.lastModifiedBy ?? 'system',
      tags: metadata?.tags ?? [],
    };
  }

  touch(): void {
    this.updatedAt = new Date();
    this.metadata.version += 1;
  }

  addTag(tag: string): void {
    if (!this.metadata.tags.includes(tag)) {
      this.metadata.tags.push(tag);
    }
  }

  abstract toJSON(): Record<string, unknown>;
}
