import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Tables, Enums } from "@/integrations/supabase/types";

type Profile = Tables<"profiles">;
type UserRole = Tables<"user_roles">;

interface UserWithRoles extends Profile {
  roles: Enums<"app_role">[];
}

export default function UserManagementPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    const { data: profiles } = await supabase.from("profiles").select("*").order("full_name");
    const { data: roles } = await supabase.from("user_roles").select("*");

    if (profiles) {
      const usersWithRoles = profiles.map((p) => ({
        ...p,
        roles: (roles || []).filter((r) => r.user_id === p.id).map((r) => r.role),
      }));
      setUsers(usersWithRoles);
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const toggleRole = async (userId: string, role: Enums<"app_role">, hasRole: boolean) => {
    if (hasRole) {
      await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    } else {
      await supabase.from("user_roles").insert({ user_id: userId, role });
    }
    toast.success(`Role ${hasRole ? "removed" : "added"}`);
    fetchUsers();
  };

  const updateSlackId = async (userId: string, slackId: string) => {
    await supabase.from("profiles").update({ slack_user_id: slackId }).eq("id", userId);
    toast.success("Slack ID updated");
    fetchUsers();
  };

  const toggleStatus = async (userId: string, currentStatus: Enums<"user_status">) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    await supabase.from("profiles").update({ status: newStatus }).eq("id", userId);
    toast.success(`User ${newStatus === "active" ? "activated" : "deactivated"}`);
    fetchUsers();
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-muted-foreground">Manage users, roles, and Slack mappings</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-4">
            {users.map((u) => (
              <Card key={u.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-foreground">{u.full_name}</p>
                        <Badge variant={u.status === "active" ? "default" : "secondary"}>
                          {u.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{u.email}</p>
                      <div className="flex gap-1 mt-2">
                        {u.roles.map((role) => (
                          <Badge key={role} variant="outline" className="text-xs">
                            {role}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs whitespace-nowrap">Slack ID:</Label>
                        <Input
                          className="w-36 h-8 text-xs"
                          defaultValue={u.slack_user_id || ""}
                          placeholder="U12345..."
                          onBlur={(e) => {
                            if (e.target.value !== (u.slack_user_id || "")) {
                              updateSlackId(u.id, e.target.value);
                            }
                          }}
                        />
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {(["manager", "admin"] as Enums<"app_role">[]).map((role) => {
                          const has = u.roles.includes(role);
                          return (
                            <Button
                              key={role}
                              size="sm"
                              variant={has ? "default" : "outline"}
                              className="text-xs h-7"
                              onClick={() => toggleRole(u.id, role, has)}
                            >
                              {has ? `✓ ${role}` : `+ ${role}`}
                            </Button>
                          );
                        })}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7"
                          onClick={() => toggleStatus(u.id, u.status)}
                        >
                          {u.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
