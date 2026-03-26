import { useState, useCallback, useRef } from 'preact/hooks';
import { rpc } from '../api.js';
import type { SearchResult } from '../../protocol/types.js';

const DEBOUNCE_MS = 300;

export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    setQuery(q);
    setError(null);

    if (timerRef.current) clearTimeout(timerRef.current);

    if (!q.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const result = await rpc<{ results: SearchResult[]; count: number }>('search', {
          query: q.trim(),
          limit: 50,
        });
        setResults(result?.results ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setSearching(false);
    setError(null);
  }, []);

  return { query, results, searching, error, search, clear };
}
