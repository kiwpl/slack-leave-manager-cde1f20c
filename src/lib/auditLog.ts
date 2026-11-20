import { format, parseISO } from "date-fns";

/**
 * Turns an audit log row into a plain sentence ("David Chen approved Maria
 * Santos's vacation request") and one small line of facts under it (the
 * request's dates, where it was done, the reason), for the Audit Log page.
 */

export interface AuditLogRow {
  action_type: string;
  actor_type: string;
  actor_id: string | null;
  details: unknown;
}

/** The request an entry is about, as far as the page could look it up. */
export interface AuditRequestInfo {
  kind: "vacation" | "sick" | "flexible";
  employeeId: string;
  ownerName: string;
  /** yyyy-MM-dd */
  start: string;
  end: string;
  startPortion?: string | null;
  endPortion?: string | null;
  /** Flexible time only, e.g. "13:00". */
  timeFrom?: string;
  timeTo?: string;
  hours?: number;
}

/** One piece of the sentence. Names are bold so the eye finds "who" first. */
export interface SentencePart {
  text: string;
  bold?: boolean;
}

const KIND_LABEL: Record<AuditRequestInfo["kind"], string> = {
  vacation: "vacation request",
  sick: "sick day",
  flexible: "flexible time request",
};

const ROLE_LABEL: Record<string, string> = {
  staff: "A staff member",
  manager: "A manager",
  admin: "An admin",
  system: "The app",
};

// Details that are already said by the sentence or the note, or that are
// only useful to the app itself. Anything else is shown as "Label: value".
const HANDLED_DETAILS = new Set([
  "via",
  "reason",
  "rejection_reason",
  "approver_name",
  "rejector_name",
  "denier_name",
  "request_type",
  "employee_id",
  "total_hours",
  "makeup_entries",
  "reverted_to",
  "changes",
]);

// What the app stores when a manager rejects without typing a reason.
const DEFAULT_REJECTION = "Rejected by manager";

function detailsOf(log: AuditLogRow): Record<string, unknown> {
  const d = log.details;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** "who did what to whose request", as pieces so names can be bold. */
export function auditSentence(
  log: AuditLogRow,
  actorName: string | null,
  req: AuditRequestInfo | null
): SentencePart[] {
  const d = detailsOf(log);
  const owner = req?.ownerName || "";
  // Slack approvals store the manager's name in the details. Staff entries
  // with no name are the request's own employee.
  const who =
    actorName ||
    text(d.approver_name) ||
    text(d.rejector_name) ||
    text(d.denier_name) ||
    (log.actor_type === "staff" ? owner : "");
  const self = !!req && (log.actor_id ? log.actor_id === req.employeeId : !!who && who === owner);

  const actor: SentencePart = who ? { text: who, bold: true } : { text: ROLE_LABEL[log.actor_type] ?? "Someone" };
  const kind = req ? KIND_LABEL[req.kind] : "request";
  const theirs: SentencePart[] = owner ? [{ text: owner, bold: true }, { text: `'s ${kind}` }] : [{ text: `a ${kind}` }];
  const own: SentencePart[] = self ? [{ text: `their ${kind}` }] : theirs;
  const say = (verb: string, object: SentencePart[], tail = ""): SentencePart[] => [
    actor,
    { text: ` ${verb} ` },
    ...object,
    ...(tail ? [{ text: tail }] : []),
  ];

  switch (log.action_type) {
    case "request_submitted":
    case "flexible_time_submitted":
      return [actor, { text: ` submitted a ${kind}` }];
    case "sick_day_auto_approved":
      return [actor, { text: " recorded a sick day" }];
    case "approved":
    case "flexible_time_approved":
      return say("approved", theirs);
    case "rejected":
    case "flexible_time_rejected":
      return say("rejected", theirs);
    case "request_edited":
      return say("edited", own);
    case "approved_request_edited":
      return say("edited", own, " after it was approved");
    case "rejected_request_resubmitted":
      return say("resubmitted", own);
    case "cancellation_requested":
      return say("asked to cancel", own);
    case "cancellation_approved":
      return say("approved cancelling", theirs);
    case "cancellation_denied":
      return say("denied cancelling", theirs);
    case "request_cancelled":
      return say("cancelled", own);
    case "reminder_sent":
      return say("sent managers a reminder about", own);
    case "manager_submitted_approved":
      return [
        actor,
        { text: ` submitted and approved a ${kind} for ` },
        owner ? { text: owner, bold: true } : { text: "a staff member" },
      ];
    case "flexible_time_completed":
      return [{ text: "The app marked " }, ...theirs, { text: " as completed" }];
    case "flexible_time_incomplete":
      return [{ text: "The app marked " }, ...theirs, { text: " as incomplete" }];
    default:
      // An action this page has no wording for yet: say who, and name the action.
      return [actor, { text: `: ${log.action_type.replace(/_/g, " ")}` }];
  }
}

/** "Dec 21 – Dec 24, 2026", "Nov 4, 2026 (morning)" or "Nov 11, 2026 · 13:00–15:00 (2h)". */
function requestWhen(req: AuditRequestInfo): string {
  try {
    const start = parseISO(req.start);
    const end = parseISO(req.end || req.start);
    if (req.kind === "flexible") {
      const time = req.timeFrom && req.timeTo ? ` · ${req.timeFrom}–${req.timeTo}` : "";
      const hours = req.hours ? ` (${Number(req.hours.toFixed(2))}h)` : "";
      return `${format(start, "MMM d, yyyy")}${time}${hours}`;
    }
    if (req.start === (req.end || req.start)) {
      const half = req.startPortion === "pm" ? " (afternoon)" : req.endPortion === "am" ? " (morning)" : "";
      return `${format(start, "MMM d, yyyy")}${half}`;
    }
    if (start.getFullYear() === end.getFullYear()) return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
    return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  } catch {
    return "";
  }
}

/** The small line: the request's dates, where it was done, and the reason or note. */
export function auditNote(log: AuditLogRow, req: AuditRequestInfo | null): string {
  const d = detailsOf(log);
  const parts: string[] = [];

  if (req) parts.push(requestWhen(req));
  if (log.action_type === "sick_day_auto_approved") parts.push("Approved automatically");

  const via = text(d.via);
  if (via === "slack") parts.push("In Slack");
  else if (via === "app") parts.push("In the app");
  else if (via) parts.push(`Via: ${via}`);

  const reason = text(d.rejection_reason) || text(d.reason);
  if (reason && reason !== DEFAULT_REJECTION) parts.push(`Reason: ${reason}`);

  // Anything else someone wrote into the entry by hand (a SQL fix, say)
  // is shown as plain "Label: value" text.
  for (const [key, value] of Object.entries(d)) {
    if (HANDLED_DETAILS.has(key)) continue;
    const shown = typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
    if (!shown) continue;
    const label = key.replace(/_/g, " ");
    parts.push(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${shown}`);
  }

  return parts.filter(Boolean).join(" · ");
}
