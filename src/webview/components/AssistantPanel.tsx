/**
 * The Assistant panel: a chat surface for talking to the architecture copilot.
 *
 * Conversational replies render as bubbles; when a reply carries a proposal,
 * an inline card lets the user apply it (which persists the new architecture
 * and triggers code generation). A live activity row shows streaming progress
 * while the AI works.
 */

import { useEffect, useRef, useState } from 'react';

import type { ChangeProposal } from '../../shared/messaging/protocol';
import type { AiStatus, ChatMessage } from '../model/useAiSession';

interface AssistantPanelProps {
  messages: ChatMessage[];
  status: AiStatus;
  progress: string[];
  onSend: (text: string) => void;
  onApplyProposal: (proposal: ChangeProposal) => void;
}

export function AssistantPanel({
  messages,
  status,
  progress,
  onSend,
  onApplyProposal,
}: AssistantPanelProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, progress, status.busy]);

  const submit = () => {
    if (!status.busy && draft.trim()) {
      onSend(draft);
      setDraft('');
    }
  };

  return (
    <div className="atlas-assistant">
      <div className="atlas-assistant__log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="atlas-assistant__hint">
            Ask about the architecture, or describe a change — e.g. “add a Redis
            cache in front of the orders database”.
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onApplyProposal={onApplyProposal}
          />
        ))}
        {status.busy && (
          <div className="atlas-activity">
            <span className="atlas-activity__spinner" aria-hidden="true" />
            <span className="atlas-activity__label">
              {progress[progress.length - 1] ?? status.label ?? 'Working…'}
            </span>
          </div>
        )}
      </div>

      <div className="atlas-assistant__composer">
        <textarea
          className="atlas-input atlas-assistant__input"
          value={draft}
          rows={2}
          placeholder="Message the architecture copilot…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className="atlas-button atlas-assistant__send"
          onClick={submit}
          disabled={status.busy || !draft.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onApplyProposal,
}: {
  message: ChatMessage;
  onApplyProposal: (proposal: ChangeProposal) => void;
}): JSX.Element {
  return (
    <div className={`atlas-bubble atlas-bubble--${message.role}`}>
      <div className="atlas-bubble__text">{message.content}</div>
      {message.proposal && (
        <div className="atlas-proposal">
          <div className="atlas-proposal__summary">{message.proposal.summary}</div>
          <button
            type="button"
            className="atlas-button atlas-button--accent atlas-proposal__apply"
            onClick={() => onApplyProposal(message.proposal!)}
          >
            Apply &amp; generate code
          </button>
        </div>
      )}
    </div>
  );
}
