/**
 * Entity CRUD operations.
 */

import { Entity, EntityStatus, EntityKind } from './types.js';

export interface CreateEntityInput {
  kind: EntityKind;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateEntityInput {
  name?: string;
  status?: EntityStatus;
  metadata?: Record<string, unknown>;
}

let nextId = 1;

export function createEntity(input: CreateEntityInput): Entity {
  const now = new Date();
  return {
    id: `ent_${nextId++}`,
    kind: input.kind,
    status: EntityStatus.Pending,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
}

export function updateEntity(entity: Entity, input: UpdateEntityInput): Entity {
  return {
    ...entity,
    name: input.name ?? entity.name,
    status: input.status ?? entity.status,
    metadata: input.metadata !== undefined
      ? { ...entity.metadata, ...input.metadata }
      : entity.metadata,
    updatedAt: new Date(),
  };
}

export function deleteEntity(entity: Entity): Entity {
  return updateEntity(entity, { status: EntityStatus.Deleted });
}
