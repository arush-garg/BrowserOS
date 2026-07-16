import { useState, useRef, useCallback } from "react";

/**
 * Props for SidebarChatbox.
 *
 * Wires into the real steer mechanism via POST /chat/:conversationId/steer.
 * Feature 1: grey preview bar shows actual typed text (or steerLastSentText) above the input.
 * Feature 2: steer messages are sent via the real API and appear as user messages.
 */
export interface SidebarChatboxProps {
  /** Conversation ID — required to call the real steer API. */
  conversationId?: string;
  /**
   * Called when a steer message is queued successfully.
   * Parents can use this to sync with their own useSteer state (e.g. lastSentText).
   */
  onSteerSent?: (text: string, status: string) => void;
  /**
   * Text to display in the grey preview bar (e.g. steerLastSentText from useSteer).
   * When provided alongside conversationId, the preview shows this even when
   * the user hasn't typed anything — mirroring the browseros-agent pattern.
   */
  steerLastSentText?: string;
  /**
   * Current steer status string (e.g. from useSteer.status).
   * Currently unused but available for future status indicator styling.
   */
  steerStatus?: string;
}

export default function SidebarChatbox({
  conversationId,
  onSteerSent,
  steerLastSentText,
  steerStatus: _steerStatus,
}: SidebarChatboxProps) {
  const [messages, setMessages] = useState<Array<{ id: number; from: "user" | "bot"; body: string; isSteer?: boolean }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [nextId, setNextId] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Call the real steer API: POST /chat/:conversationId/steer.
   * Mirrors the enqueueSteer() call in useSteer.ts.
   */
  const callSteerApi = useCallback(
    async (text: string): Promise<{ status: string } | null> => {
      if (!conversationId) return null;
      try {
        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        const res = await fetch(`${baseUrl}/chat/${conversationId}/steer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message: text }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return { status: data.status ?? "queued_next_turn" };
      } catch {
        return null;
      }
    },
    [conversationId],
  );

  const onSend = useCallback(async () => {
    const body = input.trim();
    setInput("");
    if (!body) return;

    const uid = nextId;
    const bid = nextId + 1;
    setNextId((n) => n + 2);

    // Feature 2: show as a normal user message in the conversation area
    setMessages((m) => [
      ...m,
      { id: uid, from: "user", body, isSteer: true },
    ]);
    setMessages((m) => [...m, { id: bid, from: "bot", body: "" }]);
    setLoading(true);

    // Call the real steer API
    let steerStatus = "queued_next_turn";
    if (conversationId) {
      const result = await callSteerApi(body);
      if (result) steerStatus = result.status;
    }

    setTimeout(() => {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === bid
            ? {
                ...msg,
                body: `OK — steer queued (${steerStatus.replace("queued_", "")})`,
              }
            : msg,
        ),
      );
      setLoading(false);
    }, 300);

    // Notify parent so it can sync with useSteer state (lastSentText, etc.)
    onSteerSent?.(body, steerStatus);
  }, [input, nextId, conversationId, callSteerApi, onSteerSent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Feature 1: grey preview bar — shows the actual text (user input or steerLastSentText),
  // not just a static placeholder. Mirrors the ChatFooter pattern in browseros-agent.
  const previewText = input || steerLastSentText || "";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* chat messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 8px" }}>
        {messages.length === 0 && (
          <p style={{ textAlign: "center", marginTop: 32, color: "#9ca3af", fontSize: 14 }}>
            Ask me anything
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              justifyContent: msg.from === "user" ? "flex-end" : "flex-start",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: "75%",
                borderRadius: 16,
                padding: "8px 14px",
                fontSize: 14,
                background: msg.from === "user" ? "#e5e7eb" : "#1f2937",
                color: msg.from === "user" ? "#111827" : "#f3f4f6",
                opacity: msg.isSteer ? 0.85 : 1,
              }}
            >
              {msg.body || (msg.from === "bot" ? "…" : "")}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                borderRadius: 16,
                background: "#1f2937",
                padding: "8px 14px",
                fontSize: 14,
                color: "#f3f4f6",
              }}
            >
              …
            </div>
          </div>
        )}
      </div>

      {/* Feature 1: grey preview bar — shows ACTUAL TEXT, not placeholder */}
      {previewText ? (
        <div
          style={{
            margin: "0 16px 4px",
            padding: "6px 12px",
            borderRadius: 8,
            background: "#262626",
            color: "#9ca3af",
            fontSize: 13,
          }}
          aria-live="polite"
        >
          {previewText}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={conversationId ? "Steer the agent…" : "Type something…"}
        style={{
          margin: "4px 16px 16px",
          padding: "10px 14px",
          borderRadius: 24,
          border: "none",
          outline: "none",
          background: "#1f2937",
          color: "#f3f4f6",
          fontSize: 14,
          width: "calc(100% - 32px)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}