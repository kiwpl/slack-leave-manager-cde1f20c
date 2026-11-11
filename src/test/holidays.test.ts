import { describe, expect, it } from "vitest";
import { holidaysBetween, ontarioHolidays } from "@/lib/holidays";
import { countBusinessDays } from "@/components/RequestSummary";

const dates = (year: number) => ontarioHolidays(year).map((h) => `${h.date} ${h.name}${h.observed ? " (observed)" : ""}`);

describe("Ontario stat holidays", () => {
  it("lists the 2026 holidays, with Boxing Day moved off the Saturday", () => {
    expect(dates(2026)).toEqual([
      "2026-01-01 New Year's Day",
      "2026-02-16 Family Day",
      "2026-04-03 Good Friday",
      "2026-05-18 Victoria Day",
      "2026-07-01 Canada Day",
      "2026-09-07 Labour Day",
      "2026-10-12 Thanksgiving",
      "2026-12-25 Christmas Day",
      "2026-12-28 Boxing Day (observed)",
    ]);
  });

  it("moves a weekend Christmas and Boxing Day to Mon and Tue (2027)", () => {
    const xmas = ontarioHolidays(2027).filter((h) => h.date >= "2027-12-01");
    expect(xmas.map((h) => `${h.date} ${h.name}`)).toEqual(["2027-12-27 Christmas Day", "2027-12-28 Boxing Day"]);
  });

  it("keeps Boxing Day on its Monday when Christmas is a Sunday (2022)", () => {
    const xmas = ontarioHolidays(2022).filter((h) => h.date >= "2022-12-01");
    expect(xmas.map((h) => `${h.date} ${h.name}`)).toEqual(["2022-12-26 Boxing Day", "2022-12-27 Christmas Day"]);
  });

  it("gets Easter-based Good Friday and Victoria Day right", () => {
    const find = (y: number, name: string) => ontarioHolidays(y).find((h) => h.name === name)?.date;
    expect(find(2027, "Good Friday")).toBe("2027-03-26");
    expect(find(2025, "Good Friday")).toBe("2025-04-18");
    expect(find(2027, "Victoria Day")).toBe("2027-05-24");
  });
});

describe("business days leave out stat holidays", () => {
  it("counts Dec 21, 2026 to Jan 4, 2027 as 8 days, not 11", () => {
    expect(countBusinessDays("2026-12-21", "2027-01-04")).toBe(8);
    expect(holidaysBetween("2026-12-21", "2027-01-04").map((h) => h.date)).toEqual(["2026-12-25", "2026-12-28", "2027-01-01"]);
  });

  it("still counts a normal week as 5", () => {
    expect(countBusinessDays("2026-11-16", "2026-11-20")).toBe(5);
  });
});
