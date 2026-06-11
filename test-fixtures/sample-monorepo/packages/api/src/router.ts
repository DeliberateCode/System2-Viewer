/**
 * Request routing.
 */

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
}

export interface Route {
  method: HttpMethod;
  path: string;
  handler: string;
  middleware?: string[];
}

export class Router {
  private routes: Route[] = [];

  addRoute(route: Route): void {
    const existing = this.routes.find(
      r => r.method === route.method && r.path === route.path,
    );
    if (existing) {
      throw new Error(`Route ${route.method} ${route.path} already registered`);
    }
    this.routes.push(route);
  }

  removeRoute(method: HttpMethod, path: string): boolean {
    const index = this.routes.findIndex(
      r => r.method === method && r.path === path,
    );
    if (index === -1) return false;
    this.routes.splice(index, 1);
    return true;
  }

  findRoute(method: HttpMethod, path: string): Route | undefined {
    return this.routes.find(r => r.method === method && r.path === path);
  }

  getRoutes(): Route[] {
    return [...this.routes];
  }

  getRoutesByMethod(method: HttpMethod): Route[] {
    return this.routes.filter(r => r.method === method);
  }
}
