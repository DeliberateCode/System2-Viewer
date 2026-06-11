/**
 * User model extending base model.
 */

import { BaseModel, ModelMetadata } from './base-model.js';

export enum UserRole {
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
  Guest = 'guest',
}

export class UserModel extends BaseModel {
  public name: string;
  public email: string;
  public role: UserRole;

  constructor(
    id: string,
    name: string,
    email: string,
    role: UserRole = UserRole.Viewer,
    metadata?: Partial<ModelMetadata>,
  ) {
    super(id, metadata);
    this.name = name;
    this.email = email;
    this.role = role;
  }

  isAdmin(): boolean {
    return this.role === UserRole.Admin;
  }

  canEdit(): boolean {
    return this.role === UserRole.Admin || this.role === UserRole.Editor;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      role: this.role,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      metadata: this.metadata,
    };
  }
}
