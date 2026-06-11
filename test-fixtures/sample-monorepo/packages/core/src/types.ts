/**
 * Core type definitions shared across all packages.
 */

export enum EntityStatus {
  Active = 'active',
  Inactive = 'inactive',
  Deleted = 'deleted',
  Pending = 'pending',
}

export enum EntityKind {
  User = 'user',
  Project = 'project',
  Task = 'task',
  Comment = 'comment',
}

export interface Entity {
  id: string;
  kind: EntityKind;
  status: EntityStatus;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export type EntityId = string;

export interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

export interface Identifiable {
  id: EntityId;
}

export type Predicate<T> = (item: T) => boolean;

export interface PageRequest {
  offset: number;
  limit: number;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
