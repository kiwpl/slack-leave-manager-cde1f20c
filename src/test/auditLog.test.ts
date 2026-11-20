import { describe, expect, it } from "vitest";
import { auditNote, auditSentence, type AuditLogRow, type AuditRequestInfo } from "@/lib/auditLog";

const MARIA = "id-maria";
const DAVID = "id-david";

const vacation: AuditRequestInfo = {
  kind: "vacation",
  employeeId: MARIA,
  ownerName: "Maria Santos",
  start: "2026-12-22",
  end: "2027-01-02",
};
const sickMorning: AuditRequestInfo = {
  kind: "sick",
  employeeId: MARIA,
  ownerName: "Maria Santos",
  start: "2026-11-04",
  end: "2026-11-04",
  endPortion: "am",
};
const flex: AuditRequestInfo = {
  kind: "flexible",
  employeeId: MARIA,
  ownerName: "Maria Santos",
  start: "2026-11-11",
  end: "2026-11-11",
  timeFrom: "13:00",
  timeTo: "15:00",
  hours: 2,
};

const row = (action_type: string, actor_type: string, actor_id: string | null, details: unknown = null): AuditLogRow => ({
  action_type,
  actor_type,
  actor_id,
  details,
});
const read = (log: AuditLogRow, actorName: string | null, req: AuditRequestInfo | null) =>
  auditSentence(log, actorName, req).map((p) => p.text).join("");

describe("audit log sentences", () => {
  it("says who submitted a request", () => {
    const log = row("request_submitted", "staff", MARIA, { request_type: "vacation" });
    expect(read(log, "Maria Santos", vacation)).toBe("Maria Santos submitted a vacation request");
    expect(auditNote(log, vacation)).toBe("Dec 22, 2026 – Jan 2, 2027");
  });

  it("names the manager from a Slack approval, where only the details hold the name", () => {
    const log = row("approved", "manager", null, { via: "slack", approver_name: "David Chen" });
    expect(read(log, null, vacation)).toBe("David Chen approved Maria Santos's vacation request");
    expect(auditNote(log, vacation)).toBe("Dec 22, 2026 – Jan 2, 2027 · In Slack");
  });

  it("shows a rejection reason, but not the placeholder stored when none was typed", () => {
    const typed = row("rejected", "manager", DAVID, { via: "app", rejection_reason: "Too many people off that week" });
    expect(read(typed, "David Chen", vacation)).toBe("David Chen rejected Maria Santos's vacation request");
    expect(auditNote(typed, vacation)).toBe("Dec 22, 2026 – Jan 2, 2027 · In the app · Reason: Too many people off that week");

    const blank = row("rejected", "manager", DAVID, { via: "app", rejection_reason: "Rejected by manager" });
    expect(auditNote(blank, vacation)).toBe("Dec 22, 2026 – Jan 2, 2027 · In the app");
  });

  it("says 'their' when people act on their own request", () => {
    const log = row("cancellation_requested", "staff", MARIA, { reason: "Trip moved to next year" });
    expect(read(log, "Maria Santos", vacation)).toBe("Maria Santos asked to cancel their vacation request");
    expect(auditNote(log, vacation)).toBe("Dec 22, 2026 – Jan 2, 2027 · Reason: Trip moved to next year");
  });

  it("records a sick day with its half day", () => {
    const log = row("sick_day_auto_approved", "staff", MARIA, { request_type: "sick" });
    expect(read(log, "Maria Santos", sickMorning)).toBe("Maria Santos recorded a sick day");
    expect(auditNote(log, sickMorning)).toBe("Nov 4, 2026 (morning) · Approved automatically");
  });

  it("describes flexible time with its hours", () => {
    const log = row("flexible_time_approved", "manager", DAVID, { via: "app" });
    expect(read(log, "David Chen", flex)).toBe("David Chen approved Maria Santos's flexible time request");
    expect(auditNote(log, flex)).toBe("Nov 11, 2026 · 13:00–15:00 (2h) · In the app");

    const done = row("flexible_time_completed", "system", null);
    expect(read(done, null, flex)).toBe("The app marked Maria Santos's flexible time request as completed");
  });

  it("puts a hand-made entry into plain words instead of code", () => {
    const log = row("request_edited", "admin", null, { via: "SQL fix", change: "afternoon off changed to morning off" });
    expect(read(log, null, sickMorning)).toBe("An admin edited Maria Santos's sick day");
    expect(auditNote(log, sickMorning)).toBe("Nov 4, 2026 (morning) · Via: SQL fix · Change: afternoon off changed to morning off");
  });

  it("still reads when the request or the person can no longer be found", () => {
    const log = row("approved", "manager", DAVID, { via: "app" });
    expect(read(log, null, null)).toBe("A manager approved a request");
    expect(auditNote(log, null)).toBe("In the app");

    const edit = row("approved_request_edited", "staff", MARIA, { changes: { note: "x", status: "pending_approval" } });
    expect(read(edit, "Maria Santos", vacation)).toBe("Maria Santos edited their vacation request after it was approved");
    expect(auditNote(edit, vacation)).toBe("Dec 22, 2026 – Jan 2, 2027");
  });

  it("names an action it has no wording for", () => {
    const log = row("calendar_resynced", "system", null);
    expect(read(log, null, null)).toBe("The app: calendar resynced");
  });
});
