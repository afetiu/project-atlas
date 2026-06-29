/**
 * Webview-side state for the AI workspace: chat, detection, proposals,
 * code-generation progress, pending-change tracking, and errors.
 *
 * Like `useArchitectureModel`, this hook owns one concern end-to-end. It listens
 * for the AI-related host messages and exposes intention-revealing actions, so
 * components stay declarative and never touch the message bus directly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { stripProposalBlock, type ChatTurn } from '../../shared/ai/chat';
import { compileRules } from '../../shared/rules/custom';
import type { ArchitectureRule } from '../../shared/rules/rules';
import type {
  AiJob,
  ChangeProposal,
  VerificationReport,
} from '../../shared/messaging/protocol';
import type { ArchitectureModel } from '../../shared/model/types';
import { onHostMessage, postToHost } from '../vscodeApi';

export interface AiStatus {
  busy: boolean;
  job?: AiJob;
  label?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  proposal?: ChangeProposal;
  streaming?: boolean;
}

export interface ApplyResult {
  summary: string;
  diff: string;
  revertable: boolean;
  verification: VerificationReport;
}

export interface AiErrorState {
  code: 'auth' | 'cancelled' | 'failed';
  message: string;
}

export interface AiNotice {
  tone: 'info' | 'error';
  text: string;
}

export interface AiSession {
  status: AiStatus;
  progress: string[];
  messages: ChatMessage[];
  pendingSummary: string[];
  driftedNodeIds: string[];
  customRules: ArchitectureRule[];
  applyResult: ApplyResult | null;
  reverting: boolean;
  notice: AiNotice | null;
  error: AiErrorState | null;
  detect: () => void;
  sendChat: (text: string) => void;
  applyTarget: (model: ArchitectureModel, instruction?: string) => void;
  cancel: () => void;
  configureAuth: () => void;
  revertApply: () => void;
  dismissApply: () => void;
  dismissError: () => void;
  dismissNotice: () => void;
}

const MAX_PROGRESS_LINES = 40;

export function useAiSession(): AiSession {
  const [status, setStatus] = useState<AiStatus>({ busy: false });
  const [progress, setProgress] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingSummary, setPendingSummary] = useState<string[]>([]);
  const [driftedNodeIds, setDriftedNodeIds] = useState<string[]>([]);
  const [rulesText, setRulesText] = useState('');
  const customRules = useMemo(() => compileRules(rulesText), [rulesText]);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [reverting, setReverting] = useState(false);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  const [error, setError] = useState<AiErrorState | null>(null);

  const nextId = useRef(1);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const streamingId = useRef<number | null>(null);
  const streamRaw = useRef('');

  useEffect(() => {
    return onHostMessage((message) => {
      switch (message.type) {
        case 'ai:status':
          setStatus({ busy: message.busy, job: message.job, label: message.label });
          if (message.busy) {
            setProgress([]);
            setError(null);
          }
          break;
        case 'ai:progress':
          setProgress((prev) => [...prev, message.line].slice(-MAX_PROGRESS_LINES));
          break;
        case 'ai:error':
          // A user-initiated cancel isn't a failure — don't raise the red alarm
          // banner for it; just settle any streaming bubble.
          setError(message.code === 'cancelled' ? null : { code: message.code, message: message.message });
          // Finalize any in-flight streaming bubble so it doesn't spin forever.
          if (streamingId.current !== null) {
            setMessages((prev) =>
              prev.map((m) => (m.id === streamingId.current ? { ...m, streaming: false } : m)),
            );
            streamingId.current = null;
          }
          break;
        case 'chat:token':
          streamRaw.current += message.text;
          {
            const display = stripProposalBlock(streamRaw.current);
            setMessages((prev) =>
              prev.map((m) => (m.id === streamingId.current ? { ...m, content: display } : m)),
            );
          }
          break;
        case 'chat:reply':
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingId.current
                ? { ...m, content: message.reply, proposal: message.proposal, streaming: false }
                : m,
            ),
          );
          streamingId.current = null;
          streamRaw.current = '';
          break;
        case 'sync:status':
          setPendingSummary(message.pendingSummary);
          break;
        case 'drift:status':
          setDriftedNodeIds(message.driftedNodeIds);
          break;
        case 'rules:config':
          setRulesText(message.text);
          break;
        case 'apply:done':
          setApplyResult({
            summary: message.summary,
            diff: message.diff,
            revertable: message.revertable,
            verification: message.verification,
          });
          break;
        case 'apply:reverted':
          setReverting(false);
          if (message.ok) {
            setApplyResult(null);
            setNotice({ tone: 'info', text: 'Generated changes were reverted.' });
          } else {
            setNotice({ tone: 'error', text: 'Atlas could not revert the changes.' });
          }
          break;
      }
    });
  }, []);

  const detect = useCallback(() => postToHost({ type: 'ai:detect' }), []);

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const history: ChatTurn[] = messagesRef.current.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const userId = nextId.current++;
    const assistantId = nextId.current++;
    streamingId.current = assistantId;
    streamRaw.current = '';
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: trimmed },
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    postToHost({ type: 'chat:send', message: trimmed, history });
  }, []);

  const applyTarget = useCallback((model: ArchitectureModel, instruction?: string) => {
    postToHost({ type: 'apply:request', model, instruction });
  }, []);

  const cancel = useCallback(() => postToHost({ type: 'ai:cancel' }), []);
  const configureAuth = useCallback(() => postToHost({ type: 'auth:configure' }), []);
  const revertApply = useCallback(() => {
    // Keep the diff overlay open in a busy state until the host confirms; the
    // overlay closes only on a successful 'apply:reverted'.
    setReverting(true);
    postToHost({ type: 'apply:revert' });
  }, []);
  const dismissApply = useCallback(() => setApplyResult(null), []);
  const dismissError = useCallback(() => setError(null), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    status,
    progress,
    messages,
    pendingSummary,
    driftedNodeIds,
    customRules,
    applyResult,
    reverting,
    notice,
    error,
    detect,
    sendChat,
    applyTarget,
    cancel,
    configureAuth,
    revertApply,
    dismissApply,
    dismissError,
    dismissNotice,
  };
}
