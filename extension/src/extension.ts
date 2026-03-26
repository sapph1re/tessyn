import * as vscode from 'vscode';
import { TessynClient } from './protocol/client.js';
import { ReconnectManager } from './protocol/reconnect.js';
import { StateStore } from './state/store.js';
import { StateSync } from './state/sync.js';
import { TessynSidebarProvider } from './providers/sidebar.js';
import { TessynStatusBar } from './providers/status-bar.js';

let client: TessynClient;
let reconnect: ReconnectManager;
let store: StateStore;
let sync: StateSync;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize core components
  client = new TessynClient();
  store = new StateStore();
  sync = new StateSync(client, store);
  reconnect = new ReconnectManager(client);

  // Determine project slug from workspace
  const projectSlug = getProjectSlug();

  // Start state sync
  sync.start(projectSlug);

  // Register sidebar provider
  const sidebarProvider = new TessynSidebarProvider(context.extensionUri, store, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TessynSidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    )
  );

  // Forward streaming events to sidebar
  context.subscriptions.push(
    client.onNotification((method, params) => {
      if (method.startsWith('run.')) {
        sidebarProvider.forwardEvent(method, params);
      }
    })
  );

  // Register status bar
  const statusBar = new TessynStatusBar(store);
  context.subscriptions.push(statusBar);

  // Register commands
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
    }),

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
    }),

    vscode.commands.registerCommand('tessyn.newSession', () => {
      // Focus the sidebar — actual session creation happens in the webview
      vscode.commands.executeCommand('tessyn.sidebar.focus');
    }),

    vscode.commands.registerCommand('tessyn.search', () => {
      vscode.commands.executeCommand('tessyn.sidebar.focus');
      // TODO: Send search-focus message to webview
    }),
  );

  // Refetch state on reconnect
  context.subscriptions.push(
    reconnect.onReconnect(() => {
      sync.fetchFullState().catch(() => {});
      sidebarProvider.pushFullState();
    })
  );

  // Register disposables
  context.subscriptions.push(client, reconnect, store, sync);

  // Auto-connect if configured
  const config = vscode.workspace.getConfiguration('tessyn');
  if (config.get<boolean>('autoConnect', true)) {
    // Connect asynchronously — don't block activation
    reconnect.connectWithHandshake()
      .then(() => sync.fetchFullState())
      .catch(() => {
        // Will be retried by reconnect manager
      });
  }
}

export function deactivate(): void {
  // Disposables registered in context.subscriptions are cleaned up automatically
}

function getProjectSlug(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  // Use the first workspace folder name as project slug
  // This matches Claude Code's slug encoding: non-alphanumeric chars (except -) replaced with -
  const folderPath = folders[0].uri.fsPath;
  return folderPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
