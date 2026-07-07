/**
 * Webview state for the documentation catalog: the scanned doc list, cached
 * document bodies, and which doc the reader is showing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { DocMeta } from '../../shared/docs/catalog';
import { onHostMessage, postToHost } from '../vscodeApi';

export interface DocsState {
  docs: DocMeta[];
  scanned: boolean;
  scanning: boolean;
  /** Path of the doc open in the reader, if any. */
  openPath: string | null;
  /** Cached full text by path. */
  contentByPath: Record<string, { text?: string; error?: string }>;
  scan: () => void;
  openDoc: (path: string) => void;
  closeDoc: () => void;
}

export function useDocs(): DocsState {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [contentByPath, setContentByPath] = useState<DocsState['contentByPath']>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    return onHostMessage((message) => {
      if (message.type === 'docs:list') {
        setDocs(message.docs);
        setScanned(true);
        setScanning(false);
      } else if (message.type === 'docs:content') {
        setContentByPath((prev) => ({
          ...prev,
          [message.path]: { text: message.text, error: message.error },
        }));
      }
    });
  }, []);

  const scan = useCallback(() => {
    setScanning(true);
    postToHost({ type: 'docs:scan' });
  }, []);

  const openDoc = useCallback((path: string) => {
    setOpenPath(path);
    if (!requested.current.has(path)) {
      requested.current.add(path);
      postToHost({ type: 'docs:read', path });
    }
  }, []);

  const closeDoc = useCallback(() => setOpenPath(null), []);

  return { docs, scanned, scanning, openPath, contentByPath, scan, openDoc, closeDoc };
}
