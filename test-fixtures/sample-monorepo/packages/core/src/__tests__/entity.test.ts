import { describe, it, expect } from 'vitest';
import { createEntity, updateEntity, deleteEntity } from '../entity.js';
import { EntityKind, EntityStatus } from '../types.js';

describe('entity', () => {
  it('should create an entity with pending status', () => {
    const entity = createEntity({ kind: EntityKind.User, name: 'Alice' });
    expect(entity.status).toBe(EntityStatus.Pending);
    expect(entity.name).toBe('Alice');
    expect(entity.kind).toBe(EntityKind.User);
    expect(entity.id).toBeTruthy();
  });

  it('should update entity name', () => {
    const entity = createEntity({ kind: EntityKind.Project, name: 'Proj1' });
    const updated = updateEntity(entity, { name: 'Proj2' });
    expect(updated.name).toBe('Proj2');
    expect(updated.id).toBe(entity.id);
  });

  it('should delete entity by setting status to deleted', () => {
    const entity = createEntity({ kind: EntityKind.Task, name: 'Task1' });
    const deleted = deleteEntity(entity);
    expect(deleted.status).toBe(EntityStatus.Deleted);
  });
});
