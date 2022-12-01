export interface Logger {
  log(...message: any[]): void;
}

export class NoopLogger {
  log(...message: any[]): void {
    return;
  }
}

export class DebugLogger {
  log(...message: any[]): void {
    console.log(...message);
  }
}
