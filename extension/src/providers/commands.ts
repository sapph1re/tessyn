import * as vscode from 'vscode';
import type { TessynClient } from '../protocol/client.js';
import type { StateStore } from '../state/store.js';
import type { TessynSidebarProvider } from './sidebar.js';
import type { TessynDiffProvider } from './diff.js';
import { getEditorContext, formatContextForPrompt } from './context.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: TessynClient,
  store: StateStore,
  sidebar: TessynSidebarProvider,
  diffProvider: TessynDiffProvider,
): void {
  // Show daemon status
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.showStatus', () => {
      const status = store.daemonStatus;
      if (!status) {
        vscode.window.showInformationMessage('Tessyn: Not connected to daemon');
        return;
      }
      vscode.window.showInformationMessage(
        `Tessyn v${status.version} — ${status.state}, ${status.sessionsIndexed} sessions indexed, uptime ${formatUptime(status.uptime)}`
      );
    })
  );

  // Reindex
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.reindex', async () => {
      if (!client.connected) {
        vscode.window.showWarningMessage('Tessyn: Not connected to daemon');
        return;
      }
      try {
        const result = await client.call<{ indexed: number; total: number }>('reindex');
        vscode.window.showInformationMessage(`Tessyn: Reindexed ${result.indexed} of ${result.total} sessions`);
      } catch (err) {
        vscode.window.showErrorMessage(`Tessyn: Reindex failed — ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  // New session — focus sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.newSession', () => {
      vscode.commands.executeCommand('tessyn.sidebar.focus');
    })
  );

  // Search — focus sidebar and trigger search mode
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.search', () => {
      vscode.commands.executeCommand('tessyn.sidebar.focus');
      sidebar.postMessageToWebview({ type: 'action.search' });
    })
  );

  // Send selection to Claude
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.sendSelection', () => {
      const ctx = getEditorContext();
      if (!ctx.selectedText) {
        vscode.window.showInformationMessage('Tessyn: No text selected');
        return;
      }
      const contextPrefix = formatContextForPrompt(ctx);
      vscode.commands.executeCommand('tessyn.sidebar.focus');
      sidebar.postMessageToWebview({ type: 'action.prefill', text: contextPrefix });
    })
  );

  // Open file reference (called from webview)
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.openFile', async (filePath: string, line?: number) => {
      let actualPath = filePath;
      let actualLine = line;
      const match = filePath.match(/^(.+):(\d+)$/);
      if (match) {
        actualPath = match[1];
        actualLine = parseInt(match[2], 10);
      }
      const uri = vscode.Uri.file(actualPath);
      const options: vscode.TextDocumentShowOptions = {};
      if (actualLine && actualLine > 0) {
        options.selection = new vscode.Range(actualLine - 1, 0, actualLine - 1, 0);
      }
      try {
        await vscode.window.showTextDocument(uri, options);
      } catch {
        vscode.window.showWarningMessage(`File not found: ${actualPath}`);
      }
    })
  );

  // Show diff (called from webview)
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.showDiff', async (toolName: string, toolInput: Record<string, unknown>) => {
      await diffProvider.showToolDiff(toolName, toolInput);
    })
  );

  // Cancel active run
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.cancelRun', async () => {
      const runs = store.getActiveRuns();
      if (runs.length === 0) {
        vscode.window.showInformationMessage('Tessyn: No active runs');
        return;
      }
      for (const run of runs) {
        try {
          await client.call('run.cancel', { runId: run.runId });
        } catch {
          // Ignore — run may already be done
        }
      }
    })
  );

  // Export session (markdown)
  context.subscriptions.push(
    vscode.commands.registerCommand('tessyn.exportSession', async () => {
      sidebar.postMessageToWebview({ type: 'action.export' });
    })
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
