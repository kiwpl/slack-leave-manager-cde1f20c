import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertCircle, CheckCircle } from "lucide-react";

export default function ProfileSettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const [slackUserId, setSlackUserId] = useState("");
  const [department, setDepartment] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setSlackUserId(profile.slack_user_id || "");
      setDepartment((profile as any).department || "");
      setFullName(profile.full_name || "");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        slack_user_id: slackUserId.trim() || null,
        full_name: fullName.trim(),
      })
      .eq("id", user.id);

    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success("Profile updated.");
      await refreshProfile();
    }
    setSaving(false);
  };

  const hasSlackId = !!profile?.slack_user_id;

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Profile Settings</h1>
          <p className="text-muted-foreground">Manage your profile information</p>
        </div>

        {!hasSlackId && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please add your Slack user ID before submitting a request.
            </AlertDescription>
          </Alert>
        )}

        {hasSlackId && (
          <Alert className="border-green-500/30 bg-green-500/5">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700">
              Slack user ID is set. You can submit requests.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile?.email || ""} disabled />
              <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slackUserId">Slack User ID</Label>
              <Input
                id="slackUserId"
                value={slackUserId}
                onChange={(e) => setSlackUserId(e.target.value)}
                placeholder="e.g. U01ABCDEF"
              />
              <p className="text-xs text-muted-foreground">
                Find your Slack user ID in your Slack profile → More → Copy member ID.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department (optional)</Label>
              <Input
                id="department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Engineering"
              />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
