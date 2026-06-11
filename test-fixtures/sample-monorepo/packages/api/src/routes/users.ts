/**
 * User-related API routes.
 */

import { Entity, EntityKind, createEntity, updateEntity } from '@sample/core';
import { capitalize } from '@sample/utils';
import { Route, HttpMethod } from '../router.js';

export class UserRoutes {
  private users: Map<string, Entity> = new Map();

  getRoutes(): Route[] {
    return [
      { method: HttpMethod.GET, path: '/users', handler: 'listUsers' },
      { method: HttpMethod.GET, path: '/users/:id', handler: 'getUser' },
      { method: HttpMethod.POST, path: '/users', handler: 'createUser' },
      { method: HttpMethod.PUT, path: '/users/:id', handler: 'updateUser' },
      { method: HttpMethod.DELETE, path: '/users/:id', handler: 'deleteUser' },
    ];
  }

  listUsers(): Entity[] {
    return Array.from(this.users.values());
  }

  getUser(id: string): Entity | undefined {
    return this.users.get(id);
  }

  createUser(name: string): Entity {
    const entity = createEntity({
      kind: EntityKind.User,
      name: capitalize(name),
    });
    this.users.set(entity.id, entity);
    return entity;
  }

  updateUser(id: string, name: string): Entity | undefined {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    const updated = updateEntity(existing, { name: capitalize(name) });
    this.users.set(id, updated);
    return updated;
  }
}
