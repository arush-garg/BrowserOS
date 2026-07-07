import { useState, useRef, useCallback, useEffect } from "react";

export default function SidebarChatbox({ steerToInstruct }: { steerToInstruct?: (value: string) => void }) {
  const [messages, setMessages] = useState<Array<{ id: number; from: "user" | "bot"; body: string; isSteer?: boolean }>>([]);
  const [input, setInput] = useState("");
  const [steerDisplay, setSteerDisplay] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextId, setNextId] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSend = useCallback(() => {
    const body = input.trim();
    setInput("");
    setSteerDisplay(null);
    if (!body) return;

    const uid = nextId;
    const bid = nextId + 1;
    setNextId((n) => n + 2);

    // feature 2: normal user message in conversation
    setMessages((m) => [...m, { id: uid, from: "user", body, isSteer: true }]);
    setMessages((m) => [...m, { id: bid, from: "bot", body: "" }]);
    setLoading(true);

    setTimeout(() => {
      setMessages((m) => m.map((msg) => (msg.id === bid ? { ...msg, body: "OK — \"" + body + "\"" } : msg)));
      setLoading(false);
    }, 300);

    steerToInstruct?.(body);
  }, [input, nextId, steerToInstruct]);

  // feature 1: live preview grey bar above input (only when injecting)
  useEffect(() => {
    if (!steerToInstruct) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text: string }>;
      setSteerDisplay(ce.detail?.text ?? null);
    };
    window.addEventListener("steer:text", handler as EventListener);
    return () => window.removeEventListener("steer:text", handler as EventListener);
  }, [steerToInstruct]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (steerToInstruct && input) {
        // treat as steer injection
        setSteerDisplay(input);
        setTimeout(() => onSend(), 0);
        return;
      }
      onSend();
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <ChatAreaWithScrolling>
        {messages.length === 0 && (
          <p style={{ textAlign: "center", marginTop: 32, color: "#9ca3af", fontSize: 14 }}>Ask me anything</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{ display: "flex", justifyContent: msg.from === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
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
            <div style={{ borderRadius: 16, background: "#1f2937", padding: "8px 14px", fontSize: 14, color: "#f3f4f6" }}>…</div>
          </div>
        )}
      </ChatAreaWithScrolling>

      {/* Feature 1: grey preview of typed text above input */}
      {steerDisplay && (
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
          {steerDisplay}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={steerToInstruct ? "Steer…" : "Type something…"}
        style={{
          margin: "0 16px 12px",
          borderRadius: 12,
          border: "1px solid #404040",
          background: "#171717",
          padding: "8px 12px",
          fontSize: 14,
          color: "white",
          width: "calc(100% - 32px)",
          outline: "none",
        }}
      />
    </div>
  );
}
