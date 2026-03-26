import { useState, useEffect, useCallback } from 'preact/hooks';
import { onMessage, rpc } from './api.js';
import { SessionList } from './components/SessionList.js';
import { ChatView } from './components/ChatView.js';
import { InputArea } from './components/InputArea.js';
import { SessionActions } from './components/SessionActions.js';
import { useStream } from './hooks/useStream.js';
import { useMessages } from './hooks/useMessages.js';
import { useDraft } from './hooks/useDraft.js';
import type { SessionSummary, DaemonStatus } from '../protocol/types.js';

type View = 'sessions' | 'chat';

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
  const [view, setView] = useState<View>('sessions');
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null);

  // Hooks for active session
  const { messages, loading: messagesLoading } = useMessages(activeSession?.externalId ?? null);
  const { stream, resetStream } = useStream();
  const { draft, updateDraft, clearDraft } = useDraft(activeSession?.externalId ?? null);

  // Listen for state pushes from extension host
  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      switch (msg.type) {
        case 'state.full': {
          const data = msg['data'] as AppState;
          if (data) setState(data);
          break;
        }
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

  // Update active session reference when sessions refresh
  useEffect(() => {
    if (activeSession) {
      const updated = state.sessions.find(s => s.externalId === activeSession.externalId);
      if (updated) {
        setActiveSession(updated);
      }
    }
  }, [state.sessions, activeSession?.externalId]);

  const handleSelectSession = useCallback((session: SessionSummary) => {
    setActiveSession(session);
    setView('chat');
    resetStream();
  }, [resetStream]);

  const handleBack = useCallback(() => {
    setView('sessions');
    setActiveSession(null);
    resetStream();
  }, [resetStream]);

  const handleSend = useCallback(async (text: string) => {
    if (!activeSession) return;

    clearDraft();
    resetStream();

    try {
      await rpc('run.send', {
        prompt: text,
        projectPath: '', // Extension host should fill this from workspace
        externalId: activeSession.externalId,
      });
    } catch (err) {
      // Error will show up via run.failed event
      console.error('Failed to send:', err);
    }
  }, [activeSession, clearDraft, resetStream]);

  const handleCancel = useCallback(async () => {
    if (stream.runId) {
      try {
        await rpc('run.cancel', { runId: stream.runId });
      } catch {
        // Ignore — run may already be done
      }
    }
  }, [stream.runId]);

  // Not connected
  if (!state.connected) {
    return (
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <p style={{ color: 'var(--vscode-descriptionForeground)' }}>
          Not connected to Tessyn daemon
        </p>
        <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', opacity: 0.7 }}>
          Start the daemon with: <code>tessyn start</code>
        </p>
      </div>
    );
  }

  // Session list view
  if (view === 'sessions') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {state.daemonStatus?.state === 'scanning' && (
          <div style={{
            padding: '4px 8px',
            fontSize: '11px',
            backgroundColor: 'var(--vscode-editorInfo-background)',
            color: 'var(--vscode-editorInfo-foreground)',
          }}>
            Indexing... ({state.daemonStatus.sessionsIndexed}/{state.daemonStatus.sessionsTotal})
          </div>
        )}
        <SessionList sessions={state.sessions} onSelect={handleSelectSession} />
      </div>
    );
  }

  // Chat view
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {activeSession && (
        <SessionActions session={activeSession} onBack={handleBack} />
      )}

      {messagesLoading ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--vscode-descriptionForeground)',
        }}>
          Loading messages...
        </div>
      ) : (
        <ChatView
          messages={messages}
          streamBlocks={stream.blocks}
          isStreaming={stream.active}
          streamError={stream.error}
        />
      )}

      <InputArea
        onSend={handleSend}
        onCancel={handleCancel}
        isStreaming={stream.active}
        draft={draft}
        onDraftChange={updateDraft}
        disabled={!state.connected}
      />
    </div>
  );
}
