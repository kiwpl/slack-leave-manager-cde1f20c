import { Badge } from "@/components/ui/badge";
import type { Enums } from "@/integrations/supabase/types";

const statusConfig: Record<string, { label: string; className: string }> = {
  pending_approval: {
    label: "Pending Approval",
    className: "ui-badge is-wait",
  },
  approved: {
    label: "Approved",
    className: "ui-badge is-ok",
  },
  rejected: {
    label: "Rejected",
    className: "ui-badge is-bad",
  },
  cancel_requested: {
    label: "⏳ Cancellation Pending",
    className: "ui-badge is-wait",
  },
  cancelled: {
    label: "Cancelled",
    className: "ui-badge is-mute",
  },
  completed: {
    label: "Completed",
    className: "ui-badge is-ok",
  },
  incomplete: {
    label: "Incomplete",
    className: "ui-badge is-bad",
  },
};

interface StatusBadgeProps {
  status: Enums<"request_status"> | string;
  approvalSource?: Enums<"approval_source"> | null;
}

export default function StatusBadge({ status, approvalSource }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending_approval;
  const label = status === "approved" && approvalSource === "system_auto_approved"
    ? "Auto-Approved"
    : config.label;

  return (
    <Badge variant="outline" className={config.className}>
      {label}
    </Badge>
  );
}
