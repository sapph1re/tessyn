import * as vscode from 'vscode';
import { TessynClient } from './protocol/client.js';
import { ReconnectManager } from './protocol/reconnect.js';
import { StateStore } from './state/store.js';
import { StateSync } from './state/sync.js';
import { TessynSidebarProvider } from './providers/sidebar.js';
import { TessynStatusBar } from './providers/status-bar.js';
import { TessynDiffProvider } from './providers/diff.js';
import { registerCommands } from './providers/commands.js';
import { registerNotifications } from './providers/notifications.js';
import { exportSession } from './providers/export.js';

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

  // Register diff provider
  const diffProvider = new TessynDiffProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('tessyn-diff', diffProvider),
    diffProvider,
  );

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

  // Handle diff requests from webview
  context.subscriptions.push(
    client.onNotification((method, params) => {
      if (method === 'run.block_start' && params) {
        const toolName = params['toolName'] as string | undefined;
        const toolInput = params['toolInput'] as Record<string, unknown> | undefined;
        if (toolName && toolInput && (toolName === 'Edit' || toolName === 'Write')) {
          diffProvider.showToolDiff(toolName, toolInput).catch(() => {});
        }
      }
    })
  );

  // Register status bar
  const statusBar = new TessynStatusBar(store);
  context.subscriptions.push(statusBar);

  // Register all commands
  registerCommands(context, client, store, sidebarProvider, diffProvider);

  // Register notifications
  registerNotifications(context, client, store);

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
  return folders[0].uri.fsPath.replace(/[^a-zA-Z0-9-]/g, '-');
}
