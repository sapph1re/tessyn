import type { SessionSummary } from '../../protocol/types.js';

interface SessionListProps {
  sessions: SessionSummary[];
  onSelect?: (session: SessionSummary) => void;
}

export function SessionList({ sessions, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--vscode-descriptionForeground)' }}>
        No sessions found
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      {sessions.map((session) => (
        <SessionItem key={session.externalId} session={session} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface SessionItemProps {
  session: SessionSummary;
  onSelect?: (session: SessionSummary) => void;
}

function SessionItem({ session, onSelect }: SessionItemProps) {
  const title = session.title || session.firstPrompt?.slice(0, 80) || 'Untitled session';
  const timeAgo = formatRelativeTime(session.updatedAt);

  return (
    <div
      style={{
        padding: '8px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}
      onClick={() => onSelect?.(session)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--vscode-list-hoverBackground)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
      }}
    >
      <div style={{
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--vscode-foreground)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {title}
      </div>
      <div style={{
        fontSize: '11px',
        color: 'var(--vscode-descriptionForeground)',
        marginTop: '2px',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>{session.messageCount} messages</span>
        <span>{timeAgo}</span>
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return new Date(timestamp).toLocaleDateString();
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
