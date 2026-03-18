import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface Props {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
  title: string;
  user: {
    username: string;
    role: string;
  };
  onLogout: () => void;
}

export function Layout({ children, currentPath, onNavigate, title, user, onLogout }: Props) {
  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <Sidebar currentPath={currentPath} onNavigate={onNavigate} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} user={user} onLogout={onLogout} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
