/**
 * Webview-side state for the AI workspace: chat, detection, proposals,
 * code-generation progress, pending-change tracking, and errors.
 *
 * Like `useArchitectureModel`, this hook owns one concern end-to-end. It listens
 * for the AI-related host messages and exposes intention-revealing actions, so
 * components stay declarative and never touch the message bus directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatTurn } from '../../shared/ai/chat';
import type { AiJob, ChangeProposal } from '../../shared/messaging/protocol';
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
}

export interface ApplyResult {
  summary: string;
  diff: string;
}

export interface AiErrorState {
  code: 'auth' | 'cancelled' | 'failed';
  message: string;
}

export interface AiSession {
  status: AiStatus;
  progress: string[];
  messages: ChatMessage[];
  pendingSummary: string[];
  applyResult: ApplyResult | null;
  error: AiErrorState | null;
  detect: () => void;
  sendChat: (text: string) => void;
  applyTarget: (model: ArchitectureModel, instruction?: string) => void;
  cancel: () => void;
  configureAuth: () => void;
  dismissApply: () => void;
  dismissError: () => void;
}

const MAX_PROGRESS_LINES = 40;

export function useAiSession(): AiSession {
  const [status, setStatus] = useState<AiStatus>({ busy: false });
  const [progress, setProgress] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingSummary, setPendingSummary] = useState<string[]>([]);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<AiErrorState | null>(null);

  const nextId = useRef(1);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

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
          setError({ code: message.code, message: message.message });
          break;
        case 'chat:reply':
          setMessages((prev) => [
            ...prev,
            {
              id: nextId.current++,
              role: 'assistant',
              content: message.reply,
              proposal: message.proposal,
            },
          ]);
          break;
        case 'sync:status':
          setPendingSummary(message.pendingSummary);
          break;
        case 'apply:done':
          setApplyResult({ summary: message.summary, diff: message.diff });
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
    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role: 'user', content: trimmed },
    ]);
    postToHost({ type: 'chat:send', message: trimmed, history });
  }, []);

  const applyTarget = useCallback((model: ArchitectureModel, instruction?: string) => {
    postToHost({ type: 'apply:request', model, instruction });
  }, []);

  const cancel = useCallback(() => postToHost({ type: 'ai:cancel' }), []);
  const configureAuth = useCallback(() => postToHost({ type: 'auth:configure' }), []);
  const dismissApply = useCallback(() => setApplyResult(null), []);
  const dismissError = useCallback(() => setError(null), []);

  return {
    status,
    progress,
    messages,
    pendingSummary,
    applyResult,
    error,
    detect,
    sendChat,
    applyTarget,
    cancel,
    configureAuth,
    dismissApply,
    dismissError,
  };
}
