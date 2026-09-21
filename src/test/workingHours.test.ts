import { describe, expect, it } from "vitest";
import {
  calculateClockHours,
  calculateWorkingHours,
  formatHours,
  getLunchOverlapHours,
  overlapsTimeOff,
} from "@/lib/workingHours";

describe("calculateWorkingHours", () => {
  it("returns clock time when the block does not touch lunch", () => {
    expect(calculateWorkingHours("08:30", "12:00")).toBe(3.5);
    expect(calculateWorkingHours("13:00", "17:00")).toBe(4);
  });

  it("subtracts the full lunch hour from a block that spans it", () => {
    // 08:30-13:30 is five hours on the clock, four of them working hours.
    expect(calculateClockHours("08:30", "13:30")).toBe(5);
    expect(calculateWorkingHours("08:30", "13:30")).toBe(4);
  });

  it("subtracts only the part of lunch the block actually covers", () => {
    // 08:30-12:30 looks like four hours but covers 12:00-12:30 of lunch.
    expect(calculateClockHours("08:30", "12:30")).toBe(4);
    expect(calculateWorkingHours("08:30", "12:30")).toBe(3.5);
  });

  it("treats a block that ends before it starts as zero", () => {
    expect(calculateWorkingHours("13:00", "09:00")).toBe(0);
    expect(calculateWorkingHours("", "")).toBe(0);
  });
});

describe("the shortfall this rule was added to catch", () => {
  // The reported case: 08:30-13:30 off, made up with a single 08:30-12:30 block.
  // Measuring the time off in working hours and the make-up in clock hours made
  // both read as "4h", so the two looked equal and the request was accepted.
  const hoursOff = calculateWorkingHours("08:30", "13:30");
  const makeupWorking = calculateWorkingHours("08:30", "12:30");
  const makeupClock = calculateClockHours("08:30", "12:30");

  it("used to look balanced when the two were measured differently", () => {
    expect(hoursOff).toBe(makeupClock);
  });

  it("is half an hour short once both use working hours", () => {
    expect(hoursOff - makeupWorking).toBe(0.5);
  });
});

describe("getLunchOverlapHours", () => {
  it("reports how much lunch a block covers", () => {
    expect(getLunchOverlapHours("08:30", "13:30")).toBe(1);
    expect(getLunchOverlapHours("08:30", "12:30")).toBe(0.5);
    expect(getLunchOverlapHours("09:00", "11:00")).toBe(0);
    expect(getLunchOverlapHours("13:00", "17:00")).toBe(0);
  });
});

describe("overlapsTimeOff", () => {
  const dateOff = "2026-10-08";

  it("rejects make-up time booked during the absence itself", () => {
    expect(overlapsTimeOff(dateOff, "08:30", "12:30", dateOff, "08:30", "13:30")).toBe(true);
  });

  it("allows make-up time later the same day", () => {
    expect(overlapsTimeOff(dateOff, "13:30", "17:30", dateOff, "08:30", "13:30")).toBe(false);
  });

  it("allows make-up time on any other day", () => {
    expect(overlapsTimeOff("2026-10-09", "08:30", "12:30", dateOff, "08:30", "13:30")).toBe(false);
  });

  it("ignores blocks that only touch at the boundary", () => {
    expect(overlapsTimeOff(dateOff, "07:00", "08:30", dateOff, "08:30", "13:30")).toBe(false);
  });
});

describe("formatHours", () => {
  it("drops trailing zeros", () => {
    expect(formatHours(4)).toBe("4h");
    expect(formatHours(3.5)).toBe("3.5h");
    expect(formatHours(0.25)).toBe("0.25h");
  });
});
