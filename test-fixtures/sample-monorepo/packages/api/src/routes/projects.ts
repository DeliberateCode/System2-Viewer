/**
 * Project-related API routes.
 */

import { Entity, EntityKind, createEntity } from '@sample/core';
import { slugify } from '@sample/utils';
import { Route, HttpMethod } from '../router.js';

export class ProjectRoutes {
  private projects: Map<string, Entity> = new Map();

  getRoutes(): Route[] {
    return [
      { method: HttpMethod.GET, path: '/projects', handler: 'listProjects' },
      { method: HttpMethod.GET, path: '/projects/:id', handler: 'getProject' },
      { method: HttpMethod.POST, path: '/projects', handler: 'createProject' },
    ];
  }

  listProjects(): Entity[] {
    return Array.from(this.projects.values());
  }

  getProject(id: string): Entity | undefined {
    return this.projects.get(id);
  }

  createProject(name: string): Entity {
    const entity = createEntity({
      kind: EntityKind.Project,
      name,
      metadata: { slug: slugify(name) },
    });
    this.projects.set(entity.id, entity);
    return entity;
  }
}
