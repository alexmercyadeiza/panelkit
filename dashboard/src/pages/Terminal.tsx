// ─── Terminal Page ───────────────────────────────────────────────────────────

export function TerminalPage() {
  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div>
        <h2 className="text-lg font-semibold text-white">Terminal</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Web-based terminal access to your server
        </p>
      </div>

      {/* Terminal container */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
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

        {/* Terminal body */}
        <div className="p-6 min-h-[400px] font-mono-code text-sm">
          <div className="text-zinc-500 mb-4">
            <p>PanelKit Web Terminal v1.0</p>
            <p>
              Connected to{" "}
              <span className="text-zinc-300">panelkit-server</span>
            </p>
            <p className="mt-2">---</p>
          </div>

          {/* Info message */}
          <div className="mb-6 space-y-2">
            <p className="text-amber-400">
              Web Terminal requires xterm.js integration.
            </p>
            <p className="text-zinc-500">
              Full terminal emulation with xterm.js will be available in a future
              update. This will provide a complete interactive shell experience
              with support for colors, cursor movement, and session persistence.
            </p>
          </div>

          {/* Fake prompt with blinking cursor */}
          <div className="flex items-center">
            <span className="text-emerald-400">root@panelkit</span>
            <span className="text-zinc-500">:</span>
            <span className="text-blue-400">~</span>
            <span className="text-zinc-300">$ </span>
            <span className="terminal-cursor inline-block w-2 h-4 bg-zinc-300 ml-0.5" />
          </div>
        </div>
      </div>

      {/* CSS for blinking cursor */}
      <style>{`
        .terminal-cursor {
          animation: blink 1s step-end infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
