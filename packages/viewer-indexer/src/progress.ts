/**
 * Progress reporting for verbose indexing output.
 *
 * ProgressReporter is called at each pipeline stage to emit
 * human-readable progress to stderr (when --verbose is set).
 */

export interface ProgressReporter {
  stage(
    number: number,
    total: number,
    name: string,
    count: number,
    unit: string,
    elapsedMs: number,
    extra?: string,
  ): void;
  done(totalElapsedMs: number): void;
}

export class StderrProgressReporter implements ProgressReporter {
  private readonly _write: (text: string) => void;

  constructor(write?: (text: string) => void) {
    this._write = write ?? ((text: string) => process.stderr.write(text));
  }

  stage(
    number: number,
    total: number,
    name: string,
    count: number,
    unit: string,
    elapsedMs: number,
    extra?: string,
  ): void {
    const elapsed = (elapsedMs / 1000).toFixed(1);
    const extraStr = extra ? ` [${extra}]` : '';
    this._write(
      `[${number}/${total}] ${name}... ${count} ${unit} (${elapsed}s)${extraStr}\n`,
    );
  }

  done(totalElapsedMs: number): void {
    const elapsed = (totalElapsedMs / 1000).toFixed(1);
    this._write(`Done in ${elapsed}s\n`);
  }
}

export class JsonProgressReporter implements ProgressReporter {
  private readonly _write: (text: string) => void;

  constructor(write?: (text: string) => void) {
    this._write = write ?? ((text: string) => process.stderr.write(text));
  }

  stage(
    number: number,
    total: number,
    name: string,
    count: number,
    unit: string,
    elapsedMs: number,
    _extra?: string,
  ): void {
    const line = JSON.stringify({
      type: 'stage',
      stage: number,
      total,
      name,
      count,
      unit,
      elapsedMs,
    });
    this._write(line + '\n');
  }

  done(totalElapsedMs: number): void {
    const line = JSON.stringify({
      type: 'done',
      totalElapsedMs,
    });
    this._write(line + '\n');
  }
}

export class NullProgressReporter implements ProgressReporter {
  stage(
    _number: number,
    _total: number,
    _name: string,
    _count: number,
    _unit: string,
    _elapsedMs: number,
    _extra?: string,
  ): void {
    /* no-op */
  }

  done(_totalElapsedMs: number): void {
    /* no-op */
  }
}
