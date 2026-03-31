

## Update Slack Notification Emojis

**Change**: Replace `🎉` (celebration) with `✅` (check mark) for approval notifications, and `⛔` (stop sign) with `❌` (cross mark) for rejection notifications.

### File: `supabase/functions/send-slack-notification/index.ts`

| Notification | Current Emoji | New Emoji |
|---|---|---|
| `approval_notification` | 🎉 | ✅ |
| `rejection_notification` | ⛔ | ❌ |

All other notification emojis (📋, ⏰, 📨, etc.) remain unchanged.

Redeploy the `send-slack-notification` edge function after the update.

