import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_CLIENT_ID = Deno.env.get("SLACK_CLIENT_ID");
  const SLACK_CLIENT_SECRET = Deno.env.get("SLACK_CLIENT_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  // The frontend_url is passed via state parameter or defaults
  const frontendUrl = state || url.origin.replace("/functions/v1/slack-auth", "");

  // Step 1: If no code, redirect to Slack OAuth
  if (!code) {
    if (error) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent(error)}`,
        },
      });
    }

    // For GET requests from frontend that want the authorize URL
    if (req.method === "GET") {
      const redirectUri = `${SUPABASE_URL}/functions/v1/slack-auth`;
      const slackAuthUrl = new URL("https://slack.com/openid/connect/authorize");
      slackAuthUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
      slackAuthUrl.searchParams.set("redirect_uri", redirectUri);
      slackAuthUrl.searchParams.set("scope", "openid profile email");
      slackAuthUrl.searchParams.set("response_type", "code");
      slackAuthUrl.searchParams.set("state", url.searchParams.get("redirect") || "");

      return new Response(null, {
        status: 302,
        headers: { Location: slackAuthUrl.toString() },
      });
    }
  }

  // Step 2: Exchange code for tokens
  try {
    const redirectUri = `${SUPABASE_URL}/functions/v1/slack-auth`;

    const tokenResponse = await fetch("https://slack.com/api/openid.connect.token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.ok) {
      console.error("Slack token exchange failed:", tokenData);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent("Slack authentication failed")}`,
        },
      });
    }

    // Step 3: Get user info from Slack
    const userInfoResponse = await fetch("https://slack.com/api/openid.connect.userInfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userInfo = await userInfoResponse.json();
    if (!userInfo.ok) {
      console.error("Slack userInfo failed:", userInfo);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent("Could not retrieve Slack identity")}`,
        },
      });
    }

    const slackUserId = userInfo.sub; // Slack user ID
    const slackEmail = userInfo.email;
    const slackName = userInfo.name || userInfo.real_name || slackEmail;

    console.log(`Slack auth for user: ${slackUserId} (${slackEmail})`);

    // Step 4: Look up user by slack_user_id in profiles
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("slack_user_id", slackUserId)
      .single();

    if (profileError || !profile) {
      console.error("No profile found for Slack user:", slackUserId, profileError);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent(
            "No account found for this Slack user. Contact your admin to get access."
          )}`,
        },
      });
    }

    // Step 5: Check user is active
    if (profile.status !== "active") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent(
            "Your account is inactive. Contact your admin."
          )}`,
        },
      });
    }

    // Step 6: Generate a magic link for this user via their Supabase auth email
    // First, ensure the auth user exists. Look up by profile id (which is the auth user id)
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(profile.id);

    if (authError || !authUser?.user) {
      console.error("Auth user not found for profile:", profile.id, authError);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent("Authentication error. Contact your admin.")}`,
        },
      });
    }

    // Generate magic link
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: authUser.user.email!,
      options: {
        redirectTo: `${frontendUrl}/`,
      },
    });

    if (linkError || !linkData) {
      console.error("Failed to generate magic link:", linkError);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent("Failed to create session. Try again.")}`,
        },
      });
    }

    // Extract the token hash from the action_link and redirect
    const actionLink = linkData.properties?.action_link;
    if (!actionLink) {
      console.error("No action_link in generateLink response");
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/login?error=${encodeURIComponent("Authentication error.")}`,
        },
      });
    }

    // Redirect user to the magic link which will verify and set session
    return new Response(null, {
      status: 302,
      headers: { Location: actionLink },
    });
  } catch (err) {
    console.error("Slack auth error:", err);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${frontendUrl}/login?error=${encodeURIComponent("An unexpected error occurred.")}`,
      },
    });
  }
});
