import { useEffect, useMemo, useState } from "react";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDateUTC, getPayPeriod, parseLocalDate } from "@/lib/payPeriod";
import { dayAmounts, fmtDays } from "@/components/TimeOffSummaryCard";
import type { Enums } from "@/integrations/supabase/types";

/**
 * Manager View: download days used per person (vacation, sick days, flexible
 * time hours) for a pay period or any dates, as a CSV for payroll.
 * Weekends and stat holidays are not counted; half days count 0.5.
 */

type Period = "this" | "last" | "month" | "year" | "custom";

interface Row {
  id: string;
  name: string;
  email: string;
  vac: number;
  sick: number;
  flex: number;
}

const APPROVED_TIME_OFF: Enums<"request_status">[] = ["approved", "cancel_requested"];
const APPROVED_FLEX = ["approved", "completed", "incomplete"];

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ExportTimeOffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("this");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [incVac, setIncVac] = useState(true);
  const [incSick, setIncSick] = useState(true);
  const [incFlex, setIncFlex] = useState(true);
  const [approvedOnly, setApprovedOnly] = useState(true);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState("");

  // Pay periods come from the anchor date in Admin Settings.
  useEffect(() => {
    if (!open) return;
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "pay_period_anchor_date")
      .maybeSingle()
      .then(({ data }) => setAnchor(data?.value || ""));
  }, [open]);

  const periods = useMemo(() => {
    const today = new Date();
    const list: { value: Period; label: string; from: string; to: string }[] = [];
    if (anchor) {
      const cur = getPayPeriod(today, parseLocalDate(anchor));
      const prev = getPayPeriod(new Date(cur.start.getTime() - 86400000), parseLocalDate(anchor));
      const label = (p: { start: Date; end: Date }) =>
        `${format(parseLocalDate(formatDateUTC(p.start)), "MMM d")} – ${format(parseLocalDate(formatDateUTC(p.end)), "MMM d")}`;
      list.push({ value: "this", label: `This pay period (${label(cur)})`, from: formatDateUTC(cur.start), to: formatDateUTC(cur.end) });
      list.push({ value: "last", label: `Last pay period (${label(prev)})`, from: formatDateUTC(prev.start), to: formatDateUTC(prev.end) });
    }
    list.push({
      value: "month",
      label: `This month (${format(today, "MMMM yyyy")})`,
      from: format(startOfMonth(today), "yyyy-MM-dd"),
      to: format(endOfMonth(today), "yyyy-MM-dd"),
    });
    list.push({ value: "year", label: `This year (${today.getFullYear()})`, from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` });
    list.push({ value: "custom", label: "Custom dates", from: customFrom, to: customTo });
    return list;
  }, [anchor, customFrom, customTo]);

  // No anchor set: start on "This month" instead of a pay period.
  useEffect(() => {
    if (anchor === "" && (period === "this" || period === "last")) setPeriod("month");
  }, [anchor, period]);

  const chosen = periods.find((p) => p.value === period) ?? periods[0];
  const from = chosen?.from ?? "";
  const to = chosen?.to ?? "";
  const rangeError = !from || !to ? "Pick a start and end date." : from > to ? "The start date must be on or before the end date." : "";

  useEffect(() => {
    if (!open || anchor === null || rangeError) return;
    let cancelled = false;
    setRows(null);
    setLoadError("");

    const load = async () => {
      const timeOffStatuses: Enums<"request_status">[] = approvedOnly
        ? APPROVED_TIME_OFF
        : [...APPROVED_TIME_OFF, "pending_approval"];
      const flexStatuses = approvedOnly ? APPROVED_FLEX : [...APPROVED_FLEX, "pending_approval"];
      const [timeOffRes, flexRes, peopleRes] = await Promise.all([
        supabase
          .from("time_off_requests")
          .select("employee_id, request_type, start_date, end_date, sick_date, start_day_portion, end_day_portion, status")
          .in("status", timeOffStatuses)
          .or(`and(start_date.lte.${to},end_date.gte.${from}),and(sick_date.gte.${from},sick_date.lte.${to})`),
        supabase
          .from("flexible_time_requests")
          .select("employee_id, date_off, total_hours, status")
          .in("status", flexStatuses)
          .gte("date_off", from)
          .lte("date_off", to),
        supabase.from("profiles").select("id, full_name, email, status"),
      ]);
      if (cancelled) return;
      if (timeOffRes.error || flexRes.error || peopleRes.error) {
        console.error("Export: load failed", timeOffRes.error, flexRes.error, peopleRes.error);
        setLoadError("Could not load time off. Please try again.");
        return;
      }

      const byId = new Map<string, Row>();
      for (const p of peopleRes.data ?? []) {
        if (p.status === "active") {
          byId.set(p.id, { id: p.id, name: p.full_name || p.email, email: p.email, vac: 0, sick: 0, flex: 0 });
        }
      }
      const rowFor = (id: string) => {
        let r = byId.get(id);
        if (!r) {
          const p = (peopleRes.data ?? []).find((x) => x.id === id);
          r = { id, name: p?.full_name || p?.email || `Unknown employee (id ${id.slice(0, 8)})`, email: p?.email || "", vac: 0, sick: 0, flex: 0 };
          byId.set(id, r);
        }
        return r;
      };

      for (const t of timeOffRes.data ?? []) {
        const start = t.start_date || t.sick_date;
        if (!start) continue;
        const end = t.end_date || start;
        const days = dayAmounts(start, end, t.start_day_portion, t.end_day_portion)
          .filter((d) => d.date >= from && d.date <= to)
          .reduce((s, d) => s + d.amount, 0);
        if (!days) continue;
        if (t.request_type === "sick") rowFor(t.employee_id).sick += days;
        else rowFor(t.employee_id).vac += days;
      }
      for (const f of flexRes.data ?? []) rowFor(f.employee_id).flex += Number(f.total_hours) || 0;

      setRows([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };

    load();
    return () => { cancelled = true; };
  }, [open, anchor, from, to, approvedOnly, rangeError]);

  const cols = [
    { key: "vac" as const, short: "Vacation", long: "Vacation days", on: incVac },
    { key: "sick" as const, short: "Sick", long: "Sick days", on: incSick },
    { key: "flex" as const, short: "Flex hrs", long: "Flexible hours", on: incFlex },
  ].filter((c) => c.on);

  const fileName = `time-off-${from}-to-${to}.csv`;
  const total = (k: "vac" | "sick" | "flex") => (rows ?? []).reduce((s, r) => s + r[k], 0);
  const canDownload = !rangeError && !loadError && rows !== null && cols.length > 0;

  const download = () => {
    if (!rows) return;
    const header = ["Name", "Email", ...cols.map((c) => c.long), "From", "To"];
    const lines = [
      header,
      ...rows.map((r) => [r.name, r.email, ...cols.map((c) => fmtDays(r[c.key])), from, to]),
      ["Total", "", ...cols.map((c) => fmtDays(total(c.key))), from, to],
    ];
    const csv = lines.map((l) => l.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Downloaded ${fileName}`);
    onOpenChange(false);
  };

  const th = "px-2 sm:px-3 py-2 font-medium text-muted-foreground whitespace-nowrap";
  const td = "px-2 sm:px-3 py-2";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] grid-cols-1 rounded-lg max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="px-6 sm:px-0 sm:pr-6 min-w-0">
          <DialogTitle>Export time off</DialogTitle>
          <DialogDescription>Download days used per person as a CSV file for payroll.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 min-w-0">
          <Label htmlFor="exportPeriod">Period</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger id="exportPeriod"><SelectValue /></SelectTrigger>
            <SelectContent>
              {periods.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {period === "custom" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2 min-w-0">
              <Label htmlFor="exportFrom">From</Label>
              <Input id="exportFrom" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="space-y-2 min-w-0">
              <Label htmlFor="exportTo">To</Label>
              <Input id="exportTo" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}

        <div className="space-y-2 min-w-0">
          <p className="text-sm font-medium leading-none">Include</p>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <div className="flex items-center gap-2">
              <Checkbox id="exportVac" checked={incVac} onCheckedChange={(c) => setIncVac(c === true)} />
              <Label htmlFor="exportVac" className="cursor-pointer">Vacation</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="exportSick" checked={incSick} onCheckedChange={(c) => setIncSick(c === true)} />
              <Label htmlFor="exportSick" className="cursor-pointer">Sick days</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="exportFlex" checked={incFlex} onCheckedChange={(c) => setIncFlex(c === true)} />
              <Label htmlFor="exportFlex" className="cursor-pointer">Flexible time</Label>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="exportApproved" checked={approvedOnly} onCheckedChange={(c) => setApprovedOnly(c === true)} />
          <Label htmlFor="exportApproved" className="cursor-pointer">Only approved requests</Label>
        </div>

        <div className="min-w-0">
          {rangeError ? (
            <p className="text-sm text-destructive">{rangeError}</p>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : cols.length === 0 ? (
            <p className="text-sm text-destructive">Tick at least one type to include.</p>
          ) : rows === null ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={`${th} text-left`}>Name</th>
                      {cols.map((c) => (
                        <th key={c.key} className={`${th} text-right`}>
                          <span className="sm:hidden">{c.short}</span>
                          <span className="hidden sm:inline">{c.long}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border">
                        <td className={`${td} text-foreground`}>{r.name}</td>
                        {cols.map((c) => (
                          <td key={c.key} className={`${td} text-right ${r[c.key] ? "text-foreground" : "text-muted-foreground"}`}>
                            {fmtDays(r[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className={`${td} font-semibold text-foreground`}>Total</td>
                      {cols.map((c) => (
                        <td key={c.key} className={`${td} text-right font-semibold text-foreground`}>{fmtDays(total(c.key))}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2 break-all">{fileName}</p>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={download} disabled={!canDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
