import * as vscode from 'vscode';
import fs from 'node:fs';

// Matches file paths with optional line numbers: /path/to/file.ts:42
const FILE_PATH_PATTERN = /(?:^|\s)((?:\/[\w.-]+)+(?:\.\w+)(?::(\d+))?)(?:\s|$|[,;)\]])/g;

/**
 * Opens a file at a specific line when clicking a file reference in chat output.
 */
export async function openFileReference(filePath: string, line?: number): Promise<void> {
  // Extract line number from path if present (e.g., /path/file.ts:42)
  let actualPath = filePath;
  let actualLine = line;

  const match = filePath.match(/^(.+):(\d+)$/);
  if (match) {
    actualPath = match[1];
    actualLine = parseInt(match[2], 10);
  }

  // Verify file exists
  try {
    fs.accessSync(actualPath, fs.constants.R_OK);
  } catch {
    vscode.window.showWarningMessage(`File not found: ${actualPath}`);
    return;
  }

  const uri = vscode.Uri.file(actualPath);
  const options: vscode.TextDocumentShowOptions = {};

  if (actualLine && actualLine > 0) {
    options.selection = new vscode.Range(actualLine - 1, 0, actualLine - 1, 0);
  }

  await vscode.window.showTextDocument(uri, options);
}

/**
 * Command handler for opening file references from webview messages.
 */
export function registerFileCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.openFile', (filePath: string, line?: number) => {
      openFileReference(filePath, line);
    })
  );
}
