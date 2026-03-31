import { useRef, useEffect } from 'preact/hooks';
import { useSearch } from '../hooks/useSearch.js';
import type { SearchResult, SessionSummary } from '../../protocol/types.js';

interface SearchViewProps {
  onSelectResult: (result: SearchResult) => void;
  visible: boolean;
  projectSlug?: string;
}

export function SearchView({ onSelectResult, visible, projectSlug }: SearchViewProps) {
  const { query, results, searching, error, scope, search, clear, toggleScope } = useSearch(projectSlug);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
    }
  }, [visible]);

  if (!visible) return null;

  // Group results by session
  const grouped = groupBySession(results);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '8px',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onInput={(e) => search((e.target as HTMLInputElement).value)}
            placeholder="Search all sessions..."
            style={{
              flex: 1,
              padding: '4px 8px',
              border: '1px solid var(--vscode-input-border)',
              backgroundColor: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              borderRadius: '3px',
              fontSize: 'var(--vscode-font-size)',
              fontFamily: 'var(--vscode-font-family)',
              outline: 'none',
            }}
          />
          {query && (
            <button
              onClick={clear}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--vscode-descriptionForeground)',
                cursor: 'pointer',
                padding: '0 4px',
              }}
            >
              &#10005;
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          <button
            onClick={toggleScope}
            style={{
              padding: '2px 8px',
              fontSize: '11px',
              border: '1px solid var(--vscode-input-border)',
              borderRadius: '3px',
              cursor: 'pointer',
              backgroundColor: scope === 'project'
                ? 'var(--vscode-button-secondaryBackground)'
                : 'transparent',
              color: 'var(--vscode-foreground)',
            }}
          >
            {scope === 'project' ? 'This project' : 'All projects'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {searching && (
          <div style={{ padding: '12px', color: 'var(--vscode-descriptionForeground)', textAlign: 'center' }}>
            Searching...
          </div>
        )}

        {error && (
          <div style={{ padding: '12px', color: 'var(--vscode-errorForeground)', textAlign: 'center', fontSize: '12px' }}>
            {error}
          </div>
        )}

        {!searching && query && results.length === 0 && !error && (
          <div style={{ padding: '12px', color: 'var(--vscode-descriptionForeground)', textAlign: 'center' }}>
            No results found
          </div>
        )}

        {grouped.map(([sessionTitle, sessionResults], groupIndex) => (
          <div key={`group-${groupIndex}`}>
            <div style={{
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--vscode-descriptionForeground)',
              backgroundColor: 'var(--vscode-sideBarSectionHeader-background)',
              position: 'sticky',
              top: 0,
            }}>
              {sessionTitle || 'Untitled session'}
            </div>
            {sessionResults.map((result) => (
              <SearchResultItem
                key={`${result.sessionId}-${result.messageId}`}
                result={result}
                onSelect={onSelectResult}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface SearchResultItemProps {
  result: SearchResult;
  onSelect: (result: SearchResult) => void;
}

function SearchResultItem({ result, onSelect }: SearchResultItemProps) {
  const snippet = result.content.slice(0, 150).replace(/\n/g, ' ');

  return (
    <div
      onClick={() => onSelect(result)}
      style={{
        padding: '6px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--vscode-list-hoverBackground)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
      }}
    >
      <div style={{
        fontSize: '11px',
        color: result.role === 'user' ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-descriptionForeground)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: '2px',
      }}>
        {result.role}
      </div>
      <div style={{
        fontSize: '12px',
        color: 'var(--vscode-foreground)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {snippet}
      </div>
    </div>
  );
}

function groupBySession(results: SearchResult[]): [string | null, SearchResult[]][] {
  const map = new Map<number, { title: string | null; results: SearchResult[] }>();
  for (const r of results) {
    let group = map.get(r.sessionId);
    if (!group) {
      group = { title: r.sessionTitle, results: [] };
      map.set(r.sessionId, group);
    }
    group.results.push(r);
  }
  return Array.from(map.values()).map(g => [g.title, g.results]);
}
