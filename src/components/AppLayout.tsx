import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Home, LogOut, Settings, Shield, Users, FileText, Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Time Off", icon: Home, roles: [] as string[] },
  { to: "/manager", label: "Manager View", icon: Users, roles: ["manager", "office_manager", "admin", "superadmin"] },
  { to: "/admin/settings", label: "Admin Settings", icon: Settings, roles: ["admin", "superadmin"] },
  { to: "/admin/users", label: "User Management", icon: Shield, roles: ["admin", "superadmin", "office_manager"] },
  { to: "/admin/policy", label: "Policy Editor", icon: FileText, roles: ["admin", "superadmin"] },
  { to: "/admin/audit-log", label: "Audit Log", icon: Activity, roles: ["admin", "superadmin"] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut, hasAnyRole, roles } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const visibleItems = navItems.filter(
    (item) => item.roles.length === 0 || hasAnyRole(item.roles as any)
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-card">
        <div className="p-5 border-b border-border">
          <h1 className="text-lg font-bold text-foreground">Time Off Manager</h1>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
              {profile?.full_name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-foreground">{profile?.full_name}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => { signOut(); navigate("/login"); }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col">
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <h1 className="text-lg font-bold text-foreground">Time Off Manager</h1>
          <Button variant="ghost" size="sm" onClick={() => { signOut(); navigate("/login"); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        {/* Mobile nav */}
        {visibleItems.length > 1 && (
          <nav className="md:hidden flex overflow-x-auto border-b border-border bg-card px-2 gap-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <main className="flex-1 p-4 md:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
