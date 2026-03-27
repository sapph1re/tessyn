import * as vscode from 'vscode';
import type { StateStore, StoreAspect } from '../state/store.js';
import type { TessynClient } from '../protocol/client.js';

export class TessynSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tessyn.sidebar';
  public static readonly panelViewType = 'tessyn.panel';
  private view?: vscode.WebviewView;
  private viewDisposables: vscode.Disposable[] = [];

  constructor(
    private extensionUri: vscode.Uri,
    private store: StateStore,
    private client: TessynClient,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    // Dispose previous listeners to prevent leaks on re-resolve
    for (const d of this.viewDisposables) d.dispose();
    this.viewDisposables = [];

    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Handle messages from the webview
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((msg) => this.handleWebviewMessage(msg))
    );

    // When webview signals ready, send current state
    this.viewDisposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.pushFullState();
        }
      })
    );

    // Push state updates to webview
    this.viewDisposables.push(
      this.store.onChange((aspect: StoreAspect) => {
        this.pushStateUpdate(aspect);
      })
    );

    // Clean up when view is disposed
    this.viewDisposables.push(
      webviewView.onDidDispose(() => {
        for (const d of this.viewDisposables) d.dispose();
        this.viewDisposables = [];
        this.view = undefined;
      })
    );
  }

  /**
   * Push full state snapshot to webview (on mount / visibility change).
   */
  pushFullState(): void {
    const data = {
      connected: this.store.connected,
      daemonStatus: this.store.daemonStatus,
      sessions: this.store.getSessions(),
    };
    console.log('[Tessyn Sidebar] pushFullState:', data.connected, data.sessions.length, 'sessions');
    this.postMessage({ type: 'state.full', data });
  }

  /**
   * Forward a daemon event directly to the webview.
   */
  forwardEvent(method: string, params: Record<string, unknown> | undefined): void {
    this.postMessage({ type: 'daemon.event', method, params });
  }

  private pushStateUpdate(aspect: StoreAspect): void {
    switch (aspect) {
      case 'connection':
        this.postMessage({ type: 'state.connection', connected: this.store.connected });
        break;
      case 'status':
        this.postMessage({ type: 'state.status', status: this.store.daemonStatus });
        break;
      case 'sessions':
        this.postMessage({ type: 'state.sessions', sessions: this.store.getSessions() });
        break;
      case 'runs':
        this.postMessage({ type: 'state.runs', runs: this.store.getActiveRuns() });
        break;
    }
  }

  private async handleWebviewMessage(msg: { type: string; requestId?: string; params?: Record<string, unknown> }): Promise<void> {
    if (msg.type === 'ready') {
      this.pushFullState();
      return;
    }

    // Forward RPC calls to daemon
    if (msg.type === 'rpc' && msg.params) {
      const method = msg.params['method'] as string;
      let rpcParams = msg.params['params'] as Record<string, unknown> | undefined;

      // Inject workspace path for run.send if not provided
      if (method === 'run.send' && rpcParams && !rpcParams['projectPath']) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          rpcParams = { ...rpcParams, projectPath: folders[0].uri.fsPath };
        }
      }

      try {
        const result = await this.client.call(method, rpcParams);
        this.postMessage({ type: 'rpc.result', requestId: msg.requestId, result });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.postMessage({ type: 'rpc.error', requestId: msg.requestId, error });
      }
    }
  }

  /**
   * Post a message to the webview. Public for use by commands module.
   */
  postMessageToWebview(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  private postMessage(msg: unknown): void {
    this.postMessageToWebview(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'markdown.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
  <link rel="stylesheet" href="${cssUri}">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #root {
      height: 100vh;
      overflow: auto;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
