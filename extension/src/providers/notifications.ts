import * as vscode from 'vscode';
import type { TessynClient } from '../protocol/client.js';
import type { StateStore } from '../state/store.js';

/**
 * Shows notifications when runs complete (if the extension is not focused).
 */
export function registerNotifications(
  context: vscode.ExtensionContext,
  client: TessynClient,
  store: StateStore,
): void {
  context.subscriptions.push(
    client.onNotification((method, params) => {
      if (method === 'run.completed' && params) {
        const usage = params['usage'] as { inputTokens?: number; outputTokens?: number; costUsd?: number | null } | undefined;
        const tokens = usage
          ? `${formatTokens((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))} tokens`
          : '';
        const cost = usage?.costUsd ? ` ($${usage.costUsd.toFixed(4)})` : '';

        vscode.window.showInformationMessage(
          `Tessyn: Run completed${tokens ? ` — ${tokens}${cost}` : ''}`,
          'Show Session',
        ).then(action => {
          if (action === 'Show Session') {
            vscode.commands.executeCommand('tessyn.sidebar.focus');
          }
        });
      }

      if (method === 'run.failed' && params) {
        const error = params['error'] as string;
        vscode.window.showErrorMessage(`Tessyn: Run failed — ${error}`);
      }

      if (method === 'run.rate_limit' && params) {
        const retryAfterMs = params['retryAfterMs'] as number;
        const seconds = Math.ceil(retryAfterMs / 1000);
        vscode.window.showWarningMessage(
          `Tessyn: Rate limited — retry in ${seconds}s`,
          'Switch Model',
        ).then(action => {
          if (action === 'Switch Model') {
            vscode.commands.executeCommand('tessyn.sidebar.focus');
          }
        });
      }
    })
  );
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
