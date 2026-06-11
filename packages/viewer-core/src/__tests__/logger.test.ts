import { describe, it, expect } from 'vitest';
import { createLogger, NULL_LOGGER } from '../logger.js';
import type { Logger, LogLevel } from '../logger.js';

describe('NULL_LOGGER', () => {
  it('implements Logger interface with no-op methods', () => {
    const logger: Logger = NULL_LOGGER;
    // Should not throw
    logger.error('test');
    logger.warn('test');
    logger.info('test');
    logger.debug('test');
    logger.error('test', { key: 'value' });
  });
});

describe('createLogger', () => {
  it('writes formatted lines to the provided sink', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });

    logger.info('hello');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[INFO] hello');
  });

  it('includes context as JSON when provided', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });

    logger.warn('something happened', { code: 42 });
    expect(lines[0]).toBe('[WARN] something happened {"code":42}');
  });

  it('filters messages below the configured level', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', sink: (line) => lines.push(line) });

    logger.debug('should not appear');
    logger.info('should not appear');
    logger.warn('should appear');
    logger.error('should appear');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[WARN]');
    expect(lines[1]).toContain('[ERROR]');
  });

  it('defaults to info level', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });

    logger.debug('hidden');
    logger.info('visible');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[INFO]');
  });

  it('emits error level at all thresholds', () => {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    for (const level of levels) {
      const lines: string[] = [];
      const logger = createLogger({ level, sink: (line) => lines.push(line) });
      logger.error('critical');
      expect(lines.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('debug level emits all messages', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', sink: (line) => lines.push(line) });

    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');

    expect(lines).toHaveLength(4);
  });
});
