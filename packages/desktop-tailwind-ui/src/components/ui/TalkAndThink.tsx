"use client";

import { useState, useEffect, useRef } from "react";

type SteerState = {
  placeholder: string;
  text: string;
  injectedText: string | null;
};

const DEFAULT_STEER: SteerState = {
  placeholder: "",
  text: "",
  injectedText: null,
};

export const Chatbox = ({ inject }: { inject: any }) => {
  const [steered, setSteered] = useState<SteerState>(DEFAULT_STEER);
  const [input, setInput] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // listen for steer injection events
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text: string }>;
      if (ce.detail?.text) {
        setSteered((s) => ({ ...s, injectedText: ce.detail.text }));
      }
    };
    window.addEventListener("steer:inject", handler as EventListener);
    return () =>
      window.removeEventListener("steer:inject", handler as EventListener);
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    if (inject) inject(text);
    setInput("");
    setSteered(DEFAULT_STEER);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // typing indicator preview - shows what user typed
  const previewText = steered.text || input;

  return (
    <div className="flex flex-col items-end w-full gap-0">
      {/* Feature 1: grey typing preview above chat box */}
      {previewText ? (
        <div className="mb-2 px-4 py-1.5 rounded-lg bg-neutral-800 text-gray-400 text-sm max-w-[80%] truncate select-none">
          {previewText}
        </div>
      ) : steered.injectedText ? (
        <div className="mb-2 px-4 py-1.5 rounded-lg bg-neutral-800 text-gray-400 text-sm max-w-[80%] truncate select-none">
          {steered.injectedText}
        </div>
      ) : null}

      {/* chat input row */}
      <div className="flex items-center gap-2 w-full max-w-3xl">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSteered((s) => ({ ...s, text: e.target.value }));
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={handleKeyDown}
          placeholder="Type something..."
          className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-600"
        />
        <button
          onClick={handleSend}
          className="px-4 py-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
        >
          Send
        </button>
      </div>

      {/* Feature 2: injected steer message shows as normal chat message */}
      {steered.injectedText && (
        <div className="mt-2 px-4 py-2 rounded-lg bg-gray-200 text-gray-900 text-sm w-full max-w-[80%]">
          {steered.injectedText}
        </div>
      )}
    </div>
  );
};
