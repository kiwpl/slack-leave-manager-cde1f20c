import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export default function SpecialApprovalBadge() {
  return (
    <Badge variant="outline" className="border-yellow-500/50 bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300 gap-1 text-xs">
      <AlertTriangle className="h-3 w-3" />
      Special approval
    </Badge>
  );
}
