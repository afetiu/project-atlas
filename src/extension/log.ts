/**
 * A thin diagnostic logger over a VS Code output channel ("Atlas"). It records
 * the lifecycle of AI runs — detection, chat, code generation, verification, and
 * errors — so there's a trail when something misbehaves, without leaking prompt
 * contents or secrets.
 */

import * as vscode from 'vscode';

export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel('Atlas');
  }

  info(message: string): void {
    this.channel.appendLine(`${timestamp()} ${message}`);
  }

  error(message: string): void {
    this.channel.appendLine(`${timestamp()} ERROR ${message}`);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}
