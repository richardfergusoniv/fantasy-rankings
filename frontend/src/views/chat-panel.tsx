import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CHAT_MAX_HISTORY_MESSAGES, CHAT_MAX_INPUT_CHARS } from "../../../api/_lib/chat-config";
import { api } from "../api";
import { getSessionUserId } from "../supabase";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatListItem = {
  id: string;
  title: string;
  updatedAt: string;
};

/** One-tap starters for an empty chat; they fill the box so the user can edit before sending. */
const CHAT_SUGGESTIONS = [
  "Who should I start at flex this week?",
  "Is this trade fair for me?",
  "Which waiver pickups help my roster most?",
  "How does my team stack up against my opponent?",
] as const;

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
  horizon?: "week" | "ros" | "dynasty" | null;
}) {
  const listId = useId();
  const inputId = useId();
  const queryClient = useQueryClient();
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const composerFirstRectRef = useRef<DOMRect | null>(null);
  const hadMessagesRef = useRef(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const hasMessages = messages.length > 0;

  const viewerId = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: getSessionUserId,
    staleTime: 60_000,
    retry: false,
  });

  const availability = useQuery({
    queryKey: ["chat-availability", viewerId.data ?? "anon"],
    queryFn: () => api.getChatAvailability(),
    staleTime: 60_000,
    retry: false,
    enabled: Boolean(viewerId.data),
  });

  const chatsQuery = useQuery({
    queryKey: ["chat-list", viewerId.data ?? "anon"],
    queryFn: () => api.listChats(),
    staleTime: 30_000,
    retry: false,
    enabled:
      Boolean(viewerId.data)
      && availability.isSuccess
      && availability.data.available !== false
      && !unavailable,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteChat({ id }),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ["chat-list"] });
      if (chatId === id) {
        captureComposerRect();
        setChatId(null);
        setMessages([]);
        setError(null);
      }
    },
    onError: () => {
      setError("Could not delete chat.");
    },
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

  function applySuggestion(text: string) {
    setDraft(text.slice(0, CHAT_MAX_INPUT_CHARS));
    inputRef.current?.focus();
  }

  function startNewChat() {
    if (hasMessages) captureComposerRect();
    setChatId(null);
    setMessages([]);
    setError(null);
    setDraft("");
  }

  async function openChat(id: string) {
    if (loadingChat || sending || id === chatId) return;
    setLoadingChat(true);
    setError(null);
    try {
      const result = await api.getChat({ id });
      if (!hasMessages && result.chat.messages.length > 0) captureComposerRect();
      if (hasMessages && result.chat.messages.length === 0) captureComposerRect();
      setChatId(result.chat.id);
      setMessages(
        result.chat.messages.map((item) => ({
          id: item.id,
          role: item.role,
          content: item.content,
        })),
      );
    } catch {
      setError("Could not open chat.");
    } finally {
      setLoadingChat(false);
    }
  }

  async function send() {
    const text = draft.trim().slice(0, CHAT_MAX_INPUT_CHARS);
    if (!text || sending || unavailable || loadingChat) return;
    setError(null);
    setDraft("");
    const userMessage: ChatMessage = { id: newId(), role: "user", content: text };
    const history = historyForRequest(messages);
    if (!hasMessages) captureComposerRect();
    setMessages((prev) => [...prev, userMessage]);
    setSending(true);
    try {
      const result = await api.postChat({
        message: text,
        history,
        chatId: chatId ?? undefined,
        horizon,
      });
      setChatId(result.chatId);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: result.reply },
      ]);
      void queryClient.invalidateQueries({ queryKey: ["chat-list"] });
    } catch (err) {
      captureComposerRect();
      setMessages((prev) => prev.filter((item) => item.id !== userMessage.id));
      const code = err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code ?? "")
        : "";
      const status = err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status)
        : 0;
      if (code === "chat_not_found") {
        setChatId(null);
        setMessages([]);
        void queryClient.invalidateQueries({ queryKey: ["chat-list"] });
        setError("This chat no longer exists.");
        return;
      }
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

  const chats: ChatListItem[] = chatsQuery.data?.chats ?? [];

  return (
    <section className="chat-panel" aria-label="Chat">
      <div className="chat-sidebar">
        <button
          type="button"
          className="chat-new"
          onClick={startNewChat}
          disabled={sending || loadingChat}
        >
          <span aria-hidden="true">+</span> New chat
        </button>
        {chatsQuery.isError ? (
          <div className="chat-history-status" role="alert">
            <p className="chat-error">Could not load chats.</p>
            <Button
              type="button"
              variant="secondary"
              disabled={chatsQuery.isFetching}
              onClick={() => void chatsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <ul className="chat-history" aria-label="Past chats">
            {chats.map((chat) => {
              const active = chat.id === chatId;
              return (
                <li key={chat.id} className={`chat-history-item${active ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="chat-history-open"
                    onClick={() => void openChat(chat.id)}
                    disabled={sending || loadingChat}
                    aria-current={active ? "true" : undefined}
                  >
                    {chat.title}
                  </button>
                  <button
                    type="button"
                    className="chat-history-delete"
                    aria-label={`Delete ${chat.title}`}
                    disabled={sending || loadingChat || deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(chat.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className={`chat-main${hasMessages ? " is-active" : " is-empty"}`}>
        {hasMessages ? null : (
          <div className="chat-intro">
            <h2>Ask about your league</h2>
            <p>Lineups, trades, waivers and matchups, answered from your leagues’ data.</p>
          </div>
        )}
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
            ref={inputRef}
            className="chat-input"
            placeholder="Ask about your team…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={CHAT_MAX_INPUT_CHARS}
            disabled={sending || loadingChat}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={sending || loadingChat || !draft.trim()} aria-label="Send">
            Send
          </Button>
        </form>
        {hasMessages ? null : (
          <ul className="chat-suggestions" aria-label="Suggested questions">
            {CHAT_SUGGESTIONS.map((text) => (
              <li key={text}>
                <button type="button" disabled={sending || loadingChat} onClick={() => applySuggestion(text)}>{text}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
