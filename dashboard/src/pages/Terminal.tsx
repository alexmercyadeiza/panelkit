// ─── Terminal Page ───────────────────────────────────────────────────────────

import { useEffect, useState, useRef, useCallback } from "react";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function TerminalPage() {
  const [output, setOutput] = useState<string>("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  const connect = useCallback(() => {
    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      setOutput((prev) => prev + "Connected to server.\n");
    };

    ws.onmessage = (event) => {
      setOutput((prev) => prev + event.data);
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
      setOutput((prev) => prev + "\n[Disconnected. Reconnecting in 3s...]\n");
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleSend = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && input !== "") {
      wsRef.current.send(input + "\n");
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const statusColor =
    status === "connected"
      ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
      : status === "connecting"
      ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
      : "bg-zinc-600";

  const statusText =
    status === "connected"
      ? "Connected"
      : status === "connecting"
      ? "Connecting..."
      : "Disconnected";

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Terminal</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Web-based terminal access to your server
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
          <span
            className={`text-xs font-medium ${
              status === "connected"
                ? "text-emerald-400"
                : status === "connecting"
                ? "text-amber-400"
                : "text-zinc-500"
            }`}
          >
            {statusText}
          </span>
        </div>
      </div>

      {/* Terminal container */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border-b border-zinc-800">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/80" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-xs text-zinc-500 ml-2 font-mono-code">
            panelkit -- terminal
          </span>
        </div>

        {/* Terminal output */}
        <pre
          ref={outputRef}
          className="p-4 min-h-[400px] max-h-[600px] overflow-y-auto font-mono-code text-sm text-zinc-300 whitespace-pre-wrap break-words"
        >
          {output || (
            <span className="text-zinc-500">
              {"PanelKit Web Terminal v1.0\n"}
              {"Waiting for connection...\n"}
            </span>
          )}
        </pre>

        {/* Input bar */}
        <div className="flex items-center border-t border-zinc-800 bg-zinc-900/50">
          <span className="text-emerald-400 text-sm font-mono-code pl-4 select-none">$</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={status === "connected" ? "Type a command..." : "Waiting for connection..."}
            disabled={status !== "connected"}
            className="flex-1 bg-transparent text-zinc-200 text-sm font-mono-code px-3 py-3 outline-none placeholder-zinc-600 disabled:opacity-50"
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={status !== "connected" || input === ""}
            className="px-4 py-3 text-xs font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
