interface Props {
  title: string;
  user: {
    username: string;
    role: string;
  };
  onLogout: () => void;
}

export function Header({ title, user, onLogout }: Props) {
  return (
    <header className="h-14 border-b border-zinc-800/60 bg-zinc-950 flex items-center justify-between px-6 shrink-0">
      {/* Page title - offset on mobile for hamburger button */}
      <h1 className="text-[15px] font-semibold text-white tracking-tight pl-10 lg:pl-0">
        {title}
      </h1>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {/* Avatar circle */}
          <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <span className="text-xs font-medium text-zinc-300 uppercase">
              {user.username.charAt(0)}
            </span>
          </div>
          <span className="text-sm text-zinc-300 font-medium hidden sm:inline">
            {user.username}
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-zinc-500 text-[11px] font-medium uppercase tracking-wide hidden sm:inline">
            {user.role}
          </span>
        </div>

        <div className="w-px h-5 bg-zinc-800" />

        <button
          onClick={onLogout}
          className="text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors duration-100 flex items-center gap-1.5"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
