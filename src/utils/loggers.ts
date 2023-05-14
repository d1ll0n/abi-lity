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
    stopUpdatingLog();
    console.log(...message);
  }

  status(...message: any[]): void {
    updateLog(message.join("\n"));
  }
}

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

export function updateLog(str: string): void {
  clearLastMessage();
  process.stdout.write(str);
  lastMessage = str;
}

export function stopUpdatingLog(): void {
  if (lastMessage) {
    process.stdout.write("\n");
    lastMessage = undefined;
  }
}
