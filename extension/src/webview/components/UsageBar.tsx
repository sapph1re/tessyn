import type { RunUsage } from '../../protocol/types.js';

interface UsageBarProps {
  usage: RunUsage | null;
  rateLimitRetryAt: number | null;
}

export function UsageBar({ usage, rateLimitRetryAt }: UsageBarProps) {
  if (!usage && !rateLimitRetryAt) return null;

  return (
    <div style={{
      padding: '4px 12px',
      borderTop: '1px solid var(--vscode-panel-border)',
      display: 'flex',
      gap: '12px',
      fontSize: '11px',
      color: 'var(--vscode-descriptionForeground)',
      alignItems: 'center',
    }}>
      {usage && (
        <>
          <span title="Input + output tokens">
            {formatTokens(usage.inputTokens + usage.outputTokens)} tokens
          </span>
          {usage.costUsd !== null && usage.costUsd > 0 && (
            <span title="Estimated cost">
              ${usage.costUsd.toFixed(4)}
            </span>
          )}
          {usage.durationMs > 0 && (
            <span title="Duration">
              {formatDuration(usage.durationMs)}
            </span>
          )}
        </>
      )}
      {rateLimitRetryAt && (
        <RateLimitCountdown retryAt={rateLimitRetryAt} />
      )}
    </div>
  );
}

function RateLimitCountdown({ retryAt }: { retryAt: number }) {
  const remaining = Math.max(0, retryAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);

  if (seconds <= 0) return null;

  return (
    <span style={{ color: 'var(--vscode-editorWarning-foreground)' }}>
      Rate limited — retry in {formatDuration(remaining)}
    </span>
  );
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
