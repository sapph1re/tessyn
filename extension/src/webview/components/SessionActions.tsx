import type { SessionSummary } from '../../protocol/types.js';
import { rpc } from '../api.js';

interface SessionActionsProps {
  session: SessionSummary;
  onBack: () => void;
}

export function SessionActions({ session, onBack }: SessionActionsProps) {
  const title = session.title || session.firstPrompt?.slice(0, 50) || 'Untitled';

  return (
    <div style={{
      padding: '4px 8px',
      borderBottom: '1px solid var(--vscode-panel-border)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minHeight: '32px',
    }}>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--vscode-foreground)',
          cursor: 'pointer',
          padding: '2px 4px',
          fontSize: '14px',
        }}
        title="Back to session list"
      >
        &#8592;
      </button>
      <div style={{
        flex: 1,
        fontSize: '12px',
        fontWeight: 600,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--vscode-foreground)',
      }}>
        {title}
      </div>
      <button
        onClick={() => handleRename(session)}
        style={actionButtonStyle}
        title="Rename"
      >
        &#9998;
      </button>
      <button
        onClick={() => handleArchive(session)}
        style={actionButtonStyle}
        title="Archive"
      >
        &#128451;
      </button>
    </div>
  );
}

const actionButtonStyle: Record<string, string> = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-descriptionForeground)',
  cursor: 'pointer',
  padding: '2px 4px',
  fontSize: '12px',
};

async function handleRename(session: SessionSummary): Promise<void> {
  const newTitle = prompt('Rename session:', session.title || '');
  if (newTitle !== null && newTitle.trim()) {
    await rpc('sessions.rename', {
      externalId: session.externalId,
      title: newTitle.trim(),
    });
  }
}

async function handleArchive(session: SessionSummary): Promise<void> {
  await rpc('sessions.archive', {
    externalId: session.externalId,
    archived: true,
  });
}
