import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { onMessage, type ExtensionMessage } from '../api.js';
import type { StreamBlock } from '../../state/session-state.js';
import type { RunUsage } from '../../protocol/types.js';

export interface StreamState {
  blocks: StreamBlock[];
  active: boolean;
  error: string | null;
  usage: RunUsage | null;
  runId: string | null;
}

const INITIAL_STATE: StreamState = {
  blocks: [],
  active: false,
  error: null,
  usage: null,
  runId: null,
};

/**
 * Hook to track active run stream state from daemon events forwarded by extension host.
 */
export function useStream() {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    const unsubscribe = onMessage((msg: ExtensionMessage) => {
      if (msg.type !== 'daemon.event') return;
      const method = msg['method'] as string;
      const params = msg['params'] as Record<string, unknown> | undefined;
      if (!params) return;

      const runId = params['runId'] as string;
      const current = stateRef.current;

      switch (method) {
        case 'run.started':
          setState({
            blocks: [],
            active: true,
            error: null,
            usage: null,
            runId,
          });
          break;

        case 'run.delta': {
          if (current.runId !== runId) break;
          const blockIndex = params['blockIndex'] as number;
          const delta = params['delta'] as string;
          const blockType = params['blockType'] as string;

          setState(prev => {
            const blocks = [...prev.blocks];
            while (blocks.length <= blockIndex) {
              blocks.push({
                blockIndex: blocks.length,
                blockType: 'text',
                content: '',
                complete: false,
              });
            }
            blocks[blockIndex] = {
              ...blocks[blockIndex],
              blockType,
              content: blocks[blockIndex].content + delta,
            };
            return { ...prev, blocks };
          });
          break;
        }

        case 'run.block_start': {
          if (current.runId !== runId) break;
          const blockIndex = params['blockIndex'] as number;
          const blockType = params['blockType'] as string;

          setState(prev => {
            const blocks = [...prev.blocks];
            while (blocks.length <= blockIndex) {
              blocks.push({
                blockIndex: blocks.length,
                blockType: 'text',
                content: '',
                complete: false,
              });
            }
            blocks[blockIndex] = {
              ...blocks[blockIndex],
              blockType,
              toolName: params['toolName'] as string | undefined,
              toolInput: params['toolInput'] as Record<string, unknown> | undefined,
            };
            return { ...prev, blocks };
          });
          break;
        }

        case 'run.block_stop': {
          if (current.runId !== runId) break;
          const blockIndex = params['blockIndex'] as number;

          setState(prev => {
            const blocks = [...prev.blocks];
            if (blocks[blockIndex]) {
              blocks[blockIndex] = { ...blocks[blockIndex], complete: true };
            }
            return { ...prev, blocks };
          });
          break;
        }

        case 'run.completed': {
          if (current.runId !== runId) break;
          const usage = params['usage'] as RunUsage | undefined;
          setState(prev => ({
            ...prev,
            active: false,
            usage: usage ?? null,
            blocks: prev.blocks.map(b => ({ ...b, complete: true })),
          }));
          break;
        }

        case 'run.failed': {
          if (current.runId !== runId) break;
          setState(prev => ({
            ...prev,
            active: false,
            error: params['error'] as string,
          }));
          break;
        }

        case 'run.cancelled': {
          if (current.runId !== runId) break;
          setState(prev => ({
            ...prev,
            active: false,
          }));
          break;
        }

        case 'run.rate_limit': {
          if (current.runId !== runId) break;
          const retryAfterMs = params['retryAfterMs'] as number;
          setState(prev => ({
            ...prev,
            error: `Rate limited. Retry in ${Math.ceil(retryAfterMs / 1000)}s`,
          }));
          break;
        }
      }
    });

    return unsubscribe;
  }, []);

  return { stream: state, resetStream: reset };
}
