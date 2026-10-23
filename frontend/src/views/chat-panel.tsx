import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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

export function ChatPanel() {
  const listId = useId();
  const inputId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

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
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending || unavailable) return;
    setError(null);
    setDraft("");
    const userMessage: ChatMessage = { id: newId(), role: "user", content: text };
    const history = messages.map((item) => ({ role: item.role, content: item.content }));
    setMessages((prev) => [...prev, userMessage]);
    setSending(true);
    try {
      const result = await api.postChat({ message: text, history });
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: result.reply },
      ]);
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status)
        : 0;
      const code = err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code ?? "")
        : "";
      if (status === 503 || code === "chat_unavailable") {
        setUnavailable(true);
        return;
      }
      if (status === 429) {
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
    <section className="chat-panel" aria-label="Chat">
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
          placeholder="Ask about your league"
          maxLength={2000}
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
