import { useState, useEffect } from 'preact/hooks';
import { onMessage } from './api.js';
import { SessionList } from './components/SessionList.js';
import type { SessionSummary, DaemonStatus } from '../protocol/types.js';

interface AppState {
  connected: boolean;
  daemonStatus: DaemonStatus | null;
  sessions: SessionSummary[];
}

export function App() {
  const [state, setState] = useState<AppState>({
    connected: false,
    daemonStatus: null,
    sessions: [],
  });

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      switch (msg.type) {
        case 'state.full':
          setState({
            connected: msg['data'] ? (msg['data'] as { connected: boolean }).connected : false,
            daemonStatus: msg['data'] ? (msg['data'] as { daemonStatus: DaemonStatus | null }).daemonStatus : null,
            sessions: msg['data'] ? (msg['data'] as { sessions: SessionSummary[] }).sessions : [],
          });
          break;
        case 'state.connection':
          setState(prev => ({ ...prev, connected: msg['connected'] as boolean }));
          break;
        case 'state.status':
          setState(prev => ({ ...prev, daemonStatus: msg['status'] as DaemonStatus | null }));
          break;
        case 'state.sessions':
          setState(prev => ({ ...prev, sessions: msg['sessions'] as SessionSummary[] }));
          break;
      }
    });

    return unsubscribe;
  }, []);

  if (!state.connected) {
    return (
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <p style={{ color: 'var(--vscode-descriptionForeground)' }}>
          Not connected to Tessyn daemon
        </p>
        <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', opacity: 0.7 }}>
          Start the daemon with: tessyn start
        </p>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {state.daemonStatus?.state === 'scanning' && (
        <div style={{
          padding: '4px 8px',
          fontSize: '11px',
          backgroundColor: 'var(--vscode-editorInfo-background)',
          color: 'var(--vscode-editorInfo-foreground)',
        }}>
          Indexing sessions... ({state.daemonStatus.sessionsIndexed}/{state.daemonStatus.sessionsTotal})
        </div>
      )}
      <SessionList sessions={state.sessions} />
    </div>
  );
}
