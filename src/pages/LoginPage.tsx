import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [redirecting, setRedirecting] = useState(false);

  // Show error from Slack OAuth redirect
  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      toast.error(error);
    }
  }, [searchParams]);

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      navigate("/", { replace: true });
    }
  }, [user, loading, navigate]);

  const handleSlackLogin = () => {
    setRedirecting(true);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const redirectUrl = `${window.location.origin}`;
    window.location.href = `${supabaseUrl}/functions/v1/slack-auth?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Time Off Manager</CardTitle>
          <CardDescription>
            Sign in with your Slack account to manage your time off
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full gap-2"
            size="lg"
            onClick={handleSlackLogin}
            disabled={redirecting || loading}
          >
            <MessageSquare className="h-5 w-5" />
            {redirecting ? "Redirecting to Slack..." : "Sign in with Slack"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            You must have an active employee account linked to your Slack identity.
            Contact your admin if you need access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
