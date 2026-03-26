import * as vscode from 'vscode';
import type { StateStore, StoreAspect } from '../state/store.js';

export class TessynStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: StateStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'tessyn.showStatus';
    this.update();
    this.item.show();

    this.disposables.push(
      store.onChange((aspect: StoreAspect) => {
        if (aspect === 'connection' || aspect === 'status') {
          this.update();
        }
      })
    );
  }

  private update(): void {
    if (!this.store.connected) {
      this.item.text = '$(debug-disconnect) Tessyn: Disconnected';
      this.item.tooltip = 'Not connected to Tessyn daemon';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }

    const status = this.store.daemonStatus;
    if (!status) {
      this.item.text = '$(loading~spin) Tessyn: Connecting...';
      this.item.tooltip = 'Connecting to daemon...';
      this.item.backgroundColor = undefined;
      return;
    }

    switch (status.state) {
      case 'scanning':
        this.item.text = `$(sync~spin) Tessyn: Scanning (${status.sessionsIndexed}/${status.sessionsTotal})`;
        this.item.tooltip = 'Indexing session files...';
        this.item.backgroundColor = undefined;
        break;
      case 'caught_up':
        this.item.text = `$(check) Tessyn: ${status.sessionsIndexed} sessions`;
        this.item.tooltip = `Tessyn v${status.version} — ${status.sessionsIndexed} sessions indexed`;
        this.item.backgroundColor = undefined;
        break;
      case 'degraded':
        this.item.text = '$(warning) Tessyn: Degraded';
        this.item.tooltip = 'Daemon is running in degraded mode';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      default:
        this.item.text = '$(loading~spin) Tessyn: Starting...';
        this.item.tooltip = 'Daemon is starting...';
        this.item.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.item.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
