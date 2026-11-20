import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
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
  const navigationType = useNavigationType();
  const headerRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const visibleItems = navItems.filter(
    (item) => item.roles.length === 0 || hasAnyRole(item.roles as any)
  );

  // How the page arrives: menu pages ease up card by card, a page opened from
  // a list slides in from the right, and Back slides in from the left.
  const isMenuPage = navItems.some((item) => item.to === location.pathname);
  const wentBack = navigationType === "POP" && location.key !== "default";
  const enterClass = wentBack ? "anim-pop" : isMenuPage ? "anim-tab" : "anim-push";

  // The phone top bar gets its hairline only once content has scrolled under
  // it. An observer on a 1px marker, so nothing runs while scrolling.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const header = headerRef.current;
    if (!sentinel || !header || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      header.classList.toggle("is-stuck", !entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("app-root flex min-h-screen", location.pathname === "/admin/settings" && "is-admin")}>
      {/* Sidebar */}
      <aside className="app-side hidden md:flex w-56 flex-col">
        <div className="p-5 pb-2">
          <h1 className="app-name text-foreground">Time Off Manager</h1>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                className="nav-item flex items-center gap-3 px-3 py-2 text-sm"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="app-side-foot p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="me-dot h-8 w-8 rounded-full flex items-center justify-center font-semibold text-sm">
              {profile?.full_name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-foreground">{profile?.full_name}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start font-medium text-muted-foreground"
            onClick={() => { signOut(); navigate("/login"); }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div ref={sentinelRef} className="md:hidden h-px -mb-px" aria-hidden="true" />
        <header ref={headerRef} className="app-header md:hidden flex items-center justify-between px-4 py-2">
          <h1 className="app-name text-foreground">Time Off Manager</h1>
          <Button variant="ghost" size="sm" className="ui-btn-icon text-muted-foreground" onClick={() => { signOut(); navigate("/login"); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        {/* Mobile nav */}
        {visibleItems.length > 1 && (
          <nav className="app-mobnav md:hidden grid grid-cols-3">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isActive ? "page" : undefined}
                  className="mob-item flex flex-col items-center justify-center gap-1 text-[11px] leading-tight font-medium text-center whitespace-nowrap"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <main className={cn("app-main flex-1 min-w-0 p-4 md:p-8 overflow-x-hidden overflow-y-auto break-words", enterClass)}>
          {children}
        </main>
      </div>
    </div>
  );
}
