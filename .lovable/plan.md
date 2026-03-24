

# Store Slack Secrets and Deploy Edge Functions

## What needs to happen

1. **Add two secrets** to the backend using the `add_secret` tool:
   - `SLACK_BOT_TOKEN` — the Bot User OAuth Token (`xoxb-...`)
   - `SLACK_SIGNING_SECRET` — the signing secret for verifying Slack requests

2. **Deploy all four edge functions** that depend on these secrets:
   - `send-slack-notification`
   - `slack-approval-handler`
   - `slack-events`
   - `sync-google-calendar`

3. **Test the Slack events endpoint** by calling it to confirm it responds correctly (this is the URL Slack will verify when you enable Event Subscriptions).

4. **Security recommendation**: After secrets are stored, rotate both the Bot Token and Signing Secret in your Slack app settings since they were shared in plain text in this chat.

## After implementation

- Slack notifications will fire when requests are submitted
- Managers will receive interactive approval buttons in Slack DMs
- The `slack-events` endpoint will respond to Slack's URL verification challenge

## Still needed later
- `GOOGLE_SERVICE_ACCOUNT_JSON` secret for Google Calendar sync

