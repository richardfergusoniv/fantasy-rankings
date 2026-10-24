import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CHAT_MAX_HISTORY_MESSAGES, CHAT_MAX_INPUT_CHARS } from "../../../api/_lib/chat-config";
import { api } from "../api";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function historyForRequest(messages: ChatMessage[]): Array<{ role: ChatRole; content: string }> {
  return messages
    .slice(-CHAT_MAX_HISTORY_MESSAGES)
    .map((item) => ({
      role: item.role,
      content: item.content.slice(0, CHAT_MAX_INPUT_CHARS),
    }))
    .filter((item) => item.content.length > 0);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ChatPanel({
  horizon = null,
}: {
  /** Ranking horizon the user is viewing — chat explains that window's scores. */
  horizon?: "week" | "ecr" | "ros" | "dynasty" | null;
}) {
  const listId = useId();
  const inputId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const composerFirstRectRef = useRef<DOMRect | null>(null);
  const hadMessagesRef = useRef(false);

  const hasMessages = messages.length > 0;

  const availability = useQuery({
    queryKey: ["chat-availability"],
    queryFn: () => api.getChatAvailability(),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (availability.data && !availability.data.available) setUnavailable(true);
  }, [availability.data]);

  useEffect(() => {
    if (!hasMessages) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending, hasMessages]);

  useLayoutEffect(() => {
    const flipped = hasMessages !== hadMessagesRef.current;
    hadMessagesRef.current = hasMessages;
    const first = composerFirstRectRef.current;
    composerFirstRectRef.current = null;
    const el = composerRef.current;
    if (!flipped || !first || !el || prefersReducedMotion()) return;
    const last = el.getBoundingClientRect();
    const dy = first.top - last.top;
    if (Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    void el.offsetHeight;
    el.style.transition = "transform 280ms cubic-bezier(.2, .7, .2, 1)";
    el.style.transform = "";
    const clear = (event?: TransitionEvent) => {
      if (event && (event.target !== el || event.propertyName !== "transform")) return;
      el.style.transition = "";
      el.style.transform = "";
      if (event) el.removeEventListener("transitionend", clear);
    };
    el.addEventListener("transitionend", clear);
    return () => {
      el.removeEventListener("transitionend", clear);
      clear();
    };
  }, [hasMessages]);

  function captureComposerRect() {
    composerFirstRectRef.current = composerRef.current?.getBoundingClientRect() ?? null;
  }

  async function send() {
    const text = draft.trim().slice(0, CHAT_MAX_INPUT_CHARS);
    if (!text || sending || unavailable) return;
    setError(null);
    setDraft("");
    const userMessage: ChatMessage = { id: newId(), role: "user", content: text };
    const history = historyForRequest(messages);
    if (!hasMessages) captureComposerRect();
    setMessages((prev) => [...prev, userMessage]);
    setSending(true);
    try {
      const result = await api.postChat({ message: text, history, horizon });
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: result.reply },
      ]);
    } catch (err) {
      captureComposerRect();
      setMessages((prev) => prev.filter((item) => item.id !== userMessage.id));
      const code = err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code ?? "")
        : "";
      const status = err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status)
        : 0;
      if (code === "chat_unavailable") {
        setUnavailable(true);
        return;
      }
      if (code === "chat_upstream_unavailable") {
        setError("The chat model is busy. Try again shortly.");
        return;
      }
      if (status === 429 || code === "rate_limited") {
        setError("Too many questions. Try again in a few minutes.");
        return;
      }
      setError("Chat request failed.");
    } finally {
      setSending(false);
    }
  }

  if (unavailable || (availability.isSuccess && !availability.data.available)) {
    return (
      <section className="chat-panel" aria-label="Chat">
        <p className="chat-unavailable">Chat unavailable</p>
      </section>
    );
  }

  return (
    <section
      className={`chat-panel${hasMessages ? " is-active" : " is-empty"}`}
      aria-label="Chat"
    >
      <div className="chat-thread" id={listId} role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-bubble chat-bubble-${message.role}`}
          >
            <p>{message.content}</p>
          </div>
        ))}
        {sending ? <p className="chat-status">Thinking…</p> : null}
        {error ? <p className="chat-error" role="alert">{error}</p> : null}
        <div ref={bottomRef} />
      </div>
      <form
        ref={composerRef}
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor={inputId}>Message</label>
        <input
          id={inputId}
          className="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={CHAT_MAX_INPUT_CHARS}
          disabled={sending}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="submit" disabled={sending || !draft.trim()} aria-label="Send">
          Send
        </Button>
      </form>
    </section>
  );
}
