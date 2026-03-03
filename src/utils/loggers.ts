/** Minimal logging interface used by compilation and codegen subsystems. */
export interface Logger {
  log(...message: any[]): void;
}

/** Logger that silently discards all output. */
export class NoopLogger {
  log(...message: any[]): void {
    return;
  }
}

/** Logger that writes to stdout, with an in-place status line via {@link updateLog}. */
export class DebugLogger {
  log(...message: any[]): void {
    stopUpdatingLog();
    console.log(...message);
  }

  status(...message: any[]): void {
    updateLog(message.join("\n"));
  }
}

/** Clears `n` lines above the cursor in the terminal. */
export function clearLines(n: number): void {
  for (let i = 0; i < n; i++) {
    process.stdout.clearLine(0);
    process.stdout.moveCursor(0, i === 0 ? 0 : -1);
    // process.stdout.clearLine(1);
  }
  process.stdout.cursorTo(0);
}

let lastMessage: string | undefined;

export function clearLastMessage(): void {
  if (lastMessage) {
    clearLines(lastMessage.split("\n").length);
  }
  lastMessage = undefined;
}

/** Overwrites the last status message in-place on stdout. */
export function updateLog(str: string): void {
  clearLastMessage();
  process.stdout.write(str);
  lastMessage = str;
}

/** Finalizes the current status line by writing a newline, preventing further overwrites. */
export function stopUpdatingLog(): void {
  if (lastMessage) {
    process.stdout.write("\n");
    lastMessage = undefined;
  }
}
