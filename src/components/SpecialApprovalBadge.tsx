import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export default function SpecialApprovalBadge() {
  return (
    <Badge variant="outline" className="ui-badge is-special gap-1 text-xs">
      <AlertTriangle className="h-3 w-3" />
      Special approval
    </Badge>
  );
}
