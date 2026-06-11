/**
 * Domain event bus for decoupled communication.
 */

export interface DomainEvent {
  type: string;
  payload: unknown;
  timestamp: Date;
  source: string;
}

export type EventHandler = (event: DomainEvent) => void;

export class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  off(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType);
    if (existing) {
      this.handlers.set(
        eventType,
        existing.filter(h => h !== handler),
      );
    }
  }

  emit(event: DomainEvent): void {
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      handler(event);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
