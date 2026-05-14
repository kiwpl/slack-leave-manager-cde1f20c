import { Badge } from "@/components/ui/badge";
import type { Enums } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  pending_approval: {
    label: "Pending Approval",
    className: "bg-warning/15 text-warning border-warning/30",
  },
  approved: {
    label: "Approved",
    className: "bg-success/15 text-success border-success/30",
  },
  rejected: {
    label: "Rejected",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  cancel_requested: {
    label: "⏳ Cancellation Pending",
    className: "bg-warning/15 text-warning border-warning/30",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-border",
  },
  completed: {
    label: "Completed",
    className: "bg-success/15 text-success border-success/30",
  },
  incomplete: {
    label: "Incomplete",
    className: "bg-destructive/15 text-destructive border-destructive/30",
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
    <Badge variant="outline" className={cn("font-medium", config.className)}>
      {label}
    </Badge>
  );
}
