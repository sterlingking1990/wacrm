"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCheck,
  Loader2,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  patch?: Record<string, unknown> | null;
}

interface FlowAiPanelProps {
  flowId: string;
  open: boolean;
  onClose: () => void;
  state: unknown;
  onApplyPatch: (patch: Record<string, unknown>) => void;
}

const SUGGESTIONS = [
  "Build a welcome flow that greets the customer, offers 3 support options, and routes to handoff",
  "Add a node that collects the customer's name before the greeting",
  "Add a condition after collect_input that checks if the answer contains a keyword",
  "Set the trigger to keyword and add keywords: hello, hi, start",
];

export function FlowAiPanel({
  flowId,
  open,
  onClose,
  state,
  onApplyPatch,
}: FlowAiPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [appliedSet, setAppliedSet] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch(`/api/flows/${flowId}/ai-assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, state }),
      });

      const data = (await res.json()) as {
        reply: string;
        patch?: Record<string, unknown> | null;
        error?: string;
      };

      if (!res.ok || data.error) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.error ?? "Something went wrong. Try again.",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, patch: data.patch ?? null },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Network error. Check your connection and try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function applyPatch(patch: Record<string, unknown>, idx: number) {
    onApplyPatch(patch);
    setAppliedSet((prev) => new Set([...prev, idx]));
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[400px] max-w-[92vw] flex-col border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Panel header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-white">Flow AI</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close AI panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Bot className="h-9 w-9 text-slate-700" />
              <p className="text-sm text-slate-500">
                Describe what you want to build and I&apos;ll generate or
                modify the flow for you.
              </p>
              <div className="mt-1 flex w-full flex-col gap-2 text-left">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-200"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex flex-col gap-2",
                    msg.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-primary/25 text-white"
                        : "bg-slate-900 text-slate-200",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>

                  {msg.role === "assistant" && msg.patch && (
                    <button
                      type="button"
                      onClick={() => applyPatch(msg.patch!, idx)}
                      disabled={appliedSet.has(idx)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        appliedSet.has(idx)
                          ? "cursor-default bg-emerald-500/15 text-emerald-400"
                          : "bg-primary/20 text-primary hover:bg-primary/30",
                      )}
                    >
                      {appliedSet.has(idx) ? (
                        <>
                          <CheckCheck className="h-3.5 w-3.5" />
                          Applied
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          Apply changes
                        </>
                      )}
                    </button>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex items-start">
                  <div className="rounded-xl bg-slate-900 px-3 py-2.5">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-slate-800 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Describe what to build or change…"
              className="min-h-0 resize-none bg-slate-900 text-sm"
              rows={2}
            />
            <Button
              size="sm"
              onClick={send}
              disabled={!input.trim() || loading}
              className="h-auto shrink-0 self-end"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-600">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </>
  );
}
