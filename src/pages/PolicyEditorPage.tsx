import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export default function PolicyEditorPage() {
  const { user } = useAuth();
  const [policy, setPolicy] = useState<Tables<"vacation_policy"> | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("vacation_policy")
      .select("*")
      .eq("active_flag", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setPolicy(data);
          setTitle(data.title);
          setContent(data.policy_content);
          setVersionLabel(data.version_label || "");
        }
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    if (!policy || !user) return;
    setSaving(true);

    const { error } = await supabase
      .from("vacation_policy")
      .update({
        title,
        policy_content: content,
        version_label: versionLabel,
        updated_by_user_id: user.id,
      })
      .eq("id", policy.id);

    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success("Policy updated.");
    }
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Policy Editor</h1>
          <p className="text-muted-foreground">Edit the vacation and sick day policy</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Version Label</Label>
                <Input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g., v1.1" />
              </div>
              <div className="space-y-2">
                <Label>Policy Content (Markdown supported)</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={20}
                  className="font-mono text-sm"
                />
              </div>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Policy"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
