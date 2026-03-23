import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function PolicyDisplay() {
  const [policy, setPolicy] = useState<{ title: string; policy_content: string } | null>(null);

  useEffect(() => {
    supabase
      .from("vacation_policy")
      .select("title, policy_content")
      .eq("active_flag", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => setPolicy(data));
  }, []);

  if (!policy) return null;

  // Simple markdown-like rendering for bold and lists
  const renderContent = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      if (!line.trim()) return <br key={i} />;
      // Bold headers
      if (line.startsWith("**") && line.endsWith("**")) {
        return <h4 key={i} className="font-semibold text-foreground mt-4 mb-1">{line.replace(/\*\*/g, "")}</h4>;
      }
      // List items
      if (line.startsWith("- ")) {
        return <li key={i} className="ml-4 text-sm text-muted-foreground">{line.substring(2)}</li>;
      }
      return <p key={i} className="text-sm text-muted-foreground">{line}</p>;
    });
  };

  return (
    <Card className="border-info/30 bg-info/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-info">
          <AlertCircle className="h-4 w-4" />
          {policy.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0.5">{renderContent(policy.policy_content)}</div>
      </CardContent>
    </Card>
  );
}
