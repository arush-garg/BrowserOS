"use client";

import { useState, useRef } from "react";

/**
 * TalkAndThink — steer-capable chat box.
 *
 * Wires into the real steer mechanism via POST /chat/:conversationId/steer
 * (the same API used by useSteer in browseros-agent).
 *
 * Feature 1: grey preview bar shows the actual typed text above the input.
 * Feature 2: when a steer is injected, fires onSteerInjected so the parent can
 *            display it as a normal user message in the conversation area.
 */
export interface ChatboxProps {
  /** Conversation ID — required to call the real steer API. */
  conversationId?: string;
  /**
   * Called when a steer message is successfully queued.
   * The parent uses this to:
   *   a) display the text as a normal user message in the conversation area
   *   b) clear the preview from the chat box area
   */
  onSteerInjected?: (text: string) => void;
}

export const Chatbox = ({ conversationId, onSteerInjected }: ChatboxProps) => {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Call the real steer API: POST /chat/:conversationId/steer.
   * Mirrors the enqueueSteer() call in useSteer.ts (browseros-agent).
   */
  const sendSteer = async (text: string): Promise<{ status: string } | null> => {
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
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");

    // Call the real steer API
    if (conversationId) {
      await sendSteer(text);
    }

    // Feature 2: tell the parent the steer was injected so it can:
    //   - show it as a normal user message in the conversation area
    //   - remove it from this chat box preview area
    onSteerInjected?.(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col items-end w-full gap-0">
      {/* Feature 1: grey preview bar — shows ACTUAL TEXT, not just placeholder */}
      {input && (
        <div className="mb-2 px-4 py-1.5 rounded-lg bg-neutral-800 text-gray-400 text-sm max-w-[80%] truncate select-none">
          {input}
        </div>
      )}

      {/* chat input row */}
      <div className="flex items-center gap-2 w-full max-w-3xl">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={conversationId ? "Steer the agent…" : "Type something…"}
          className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-600"
        />
        <button
          onClick={handleSend}
          className="px-4 py-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
};