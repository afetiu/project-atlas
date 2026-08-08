/**
 * Console-based counterpart to `extension/log.ts`'s VS Code output channel.
 * Same shape ({@link Logger}), so `StudioSession` needs no branching to use it.
 */

export interface Logger {
  info(message: string): void;
  error(message: string): void;
  dispose(): void;
}

export class StandaloneLogger implements Logger {
  info(message: string): void {
    console.log(`${timestamp()} ${message}`);
  }

  error(message: string): void {
    console.error(`${timestamp()} ERROR ${message}`);
  }

  dispose(): void {
    // Nothing to release — stdout/stderr outlive the session.
  }
}

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}
