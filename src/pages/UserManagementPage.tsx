import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { Tables, Enums } from "@/integrations/supabase/types";
import { KeyRound, Trash2, UserPlus } from "lucide-react";

type Profile = Tables<"profiles">;

interface UserWithRoles extends Profile {
  roles: Enums<"app_role">[];
}

export default function UserManagementPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [loading, setLoading] = useState(true);

  // Password reset dialog
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserWithRoles | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserWithRoles | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Add user dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addFullName, setAddFullName] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [adding, setAdding] = useState(false);

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

  // Password reset
  const openResetDialog = (u: UserWithRoles) => {
    setResetTarget(u);
    setNewPassword("");
    setConfirmPassword("");
    setResetDialogOpen(true);
  };

  const handleSetPassword = async () => {
    if (!resetTarget) return;
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match."); return; }
    setResetting(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { action: "set-password", userId: resetTarget.id, password: newPassword },
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Failed to set password");
    } else {
      toast.success(`Password updated for ${resetTarget.full_name}`);
      setResetDialogOpen(false);
    }
    setResetting(false);
  };

  const handleSendResetEmail = async () => {
    if (!resetTarget) return;
    setResetting(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { action: "send-reset", email: resetTarget.email },
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Failed to send reset email");
    } else {
      toast.success(`Password reset email sent to ${resetTarget.email}`);
      setResetDialogOpen(false);
    }
    setResetting(false);
  };

  // Delete user
  const openDeleteDialog = (u: UserWithRoles) => {
    setDeleteTarget(u);
    setDeleteDialogOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { action: "delete-user", userId: deleteTarget.id },
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Failed to delete user");
    } else {
      toast.success(`${deleteTarget.full_name} has been deleted`);
      setDeleteDialogOpen(false);
      fetchUsers();
    }
    setDeleting(false);
  };

  // Add user
  const handleAddUser = async () => {
    if (!addEmail || !addFullName || !addPassword) {
      toast.error("All fields are required.");
      return;
    }
    if (addPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setAdding(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { action: "create-user", email: addEmail, fullName: addFullName, password: addPassword },
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Failed to create user");
    } else {
      toast.success(`${addFullName} has been added`);
      setAddDialogOpen(false);
      setAddEmail("");
      setAddFullName("");
      setAddPassword("");
      fetchUsers();
    }
    setAdding(false);
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">User Management</h1>
            <p className="text-muted-foreground">Manage users, roles, and Slack mappings</p>
          </div>
          <Button onClick={() => setAddDialogOpen(true)} size="sm">
            <UserPlus className="h-4 w-4 mr-1" /> Add User
          </Button>
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
                      <p className="font-medium text-foreground">{u.full_name}</p>
                      <p className="text-sm text-muted-foreground">{u.email}</p>
                      <div className="flex gap-1 mt-2">
                        {u.roles.map((role) => (
                          <Badge key={role} variant="outline" className="text-xs">{role}</Badge>
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
                            <Button key={role} size="sm" variant={has ? "default" : "outline"} className="text-xs h-7" onClick={() => toggleRole(u.id, role, has)}>
                              {has ? `✓ ${role}` : `+ ${role}`}
                            </Button>
                          );
                        })}
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openResetDialog(u)}>
                          <KeyRound className="h-3 w-3 mr-1" /> Reset Password
                        </Button>
                        <Button size="sm" variant="destructive" className="text-xs h-7" onClick={() => openDeleteDialog(u)} disabled={u.id === user?.id}>
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
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

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account. They will be assigned the staff role by default.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="addFullName">Full Name</Label>
              <Input id="addFullName" value={addFullName} onChange={(e) => setAddFullName(e.target.value)} placeholder="John Smith" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addEmail">Email</Label>
              <Input id="addEmail" type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="john@company.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addPassword">Password</Label>
              <Input id="addPassword" type="password" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} placeholder="Min 6 characters" minLength={6} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={adding}>
              {adding ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Reset password for <strong>{resetTarget?.full_name}</strong> ({resetTarget?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">Option 1: Set a new password</h4>
              <div className="space-y-2">
                <Label htmlFor="adminNewPassword" className="text-xs">New Password</Label>
                <Input id="adminNewPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 6 characters" minLength={6} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminConfirmPassword" className="text-xs">Confirm Password</Label>
                <Input id="adminConfirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" minLength={6} />
              </div>
              <Button onClick={handleSetPassword} disabled={resetting || !newPassword} className="w-full" size="sm">
                {resetting ? "Setting..." : "Set Password"}
              </Button>
            </div>
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or</span></div>
            </div>
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">Option 2: Send reset email</h4>
              <p className="text-xs text-muted-foreground">Send a password reset link to the user's email address.</p>
              <Button variant="outline" onClick={handleSendResetEmail} disabled={resetting} className="w-full" size="sm">
                {resetting ? "Sending..." : "Send Reset Email"}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetDialogOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user account</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.full_name}</strong> ({deleteTarget?.email}) and all their data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
