import { expect, test } from "bun:test"
import { ToolError } from "../errors"
import { DAY_RANGE, TIME_RANGE, dayRange, timeRange } from "./range"

const NOW = new Date("2026-11-07T15:42:09.789Z")
const BAD_FORMS = ["", "yesterday", "2026-11-1", "2026-11-01 09:00:00", "2026-11-01T09:00:00", "2026-11-01T09:00Z"]
const IMPOSSIBLE = [
  "2026-02-30",
  "2027-02-29",
  "2026-13-01",
  "2026-00-10",
  "2026-11-01T25:00:00Z",
  "2026-11-01T09:60:00Z",
]

function refusal(run: () => unknown): ToolError {
  try {
    run()
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("Expected refusal")
}

function expectInvalid(run: () => unknown, message: string): void {
  const error = refusal(run)
  expect(error.code).toBe("invalid_argument")
  expect(error.message).toBe(message)
}

test("dayRange defaults to today and the six days before it", () => {
  expect(dayRange({}, NOW)).toEqual({ since: "2026-11-01", until: "2026-11-07" })
  expect(DAY_RANGE.defaultDays).toBe(7)
})

test("dayRange fills in only the missing bound", () => {
  expect(dayRange({ since: "2026-10-01" }, NOW)).toEqual({ since: "2026-10-01", until: "2026-11-07" })
  expect(dayRange({ until: "2026-03-02" }, NOW)).toEqual({ since: "2026-02-24", until: "2026-03-02" })
})

test("dayRange accepts one day, a leap day and month and year boundaries", () => {
  expect(dayRange({ since: "2026-11-03", until: "2026-11-03" }, NOW)).toEqual({
    since: "2026-11-03",
    until: "2026-11-03",
  })
  expect(dayRange({ since: "2028-02-28", until: "2028-03-01" }, NOW)).toEqual({
    since: "2028-02-28",
    until: "2028-03-01",
  })
  expect(dayRange({ since: "2028-02-29", until: "2028-02-29" }, NOW).since).toBe("2028-02-29")
  expect(dayRange({ until: "2026-01-03" }, NOW)).toEqual({ since: "2025-12-28", until: "2026-01-03" })
})

test("dayRange takes 366 days and refuses 367", () => {
  expect(dayRange({ since: "2025-11-07", until: "2026-11-07" }, NOW).since).toBe("2025-11-07")
  expect(dayRange({ since: "2025-11-06", until: "2026-11-06" }, NOW).until).toBe("2026-11-06")
  expect(DAY_RANGE.maxDays).toBe(366)
  expectInvalid(
    () => dayRange({ since: "2025-11-06", until: "2026-11-07" }, NOW),
    "traffic reads at most 366 days at once.",
  )
})

test("dayRange refuses a since after until", () => {
  expectInvalid(() => dayRange({ since: "2026-11-05", until: "2026-11-04" }, NOW), "`since` must not be after `until`.")
  expectInvalid(() => dayRange({ since: "2026-11-08" }, NOW), "`since` must not be after `until`.")
})

test("dayRange refuses times, other forms and impossible dates, naming the argument", () => {
  expectInvalid(
    () => dayRange({ since: "2026-11-01T09:00:00Z" }, NOW),
    "`since` must be a date (2026-11-01): traffic counts whole UTC days.",
  )
  expectInvalid(
    () => dayRange({ until: "2026-11-01T09:00:00Z" }, NOW),
    "`until` must be a date (2026-11-01): traffic counts whole UTC days.",
  )
  const form = "must be a UTC date (2026-11-01) or a UTC time (2026-11-01T09:00:00Z)."
  for (const bad of [...BAD_FORMS, ...IMPOSSIBLE.filter((value) => !value.includes("T"))]) {
    expectInvalid(() => dayRange({ since: bad }, NOW), `\`since\` ${form}`)
    expectInvalid(() => dayRange({ until: bad }, NOW), `\`until\` ${form}`)
  }
})

test("timeRange defaults to the last 24 hours with milliseconds dropped", () => {
  expect(timeRange({}, NOW)).toEqual({ since: "2026-11-06T15:42:09Z", until: "2026-11-07T15:42:09Z" })
  expect(TIME_RANGE.defaultHours).toBe(24)
})

test("timeRange fills in only the missing bound", () => {
  expect(timeRange({ since: "2026-11-07T09:00:00Z" }, NOW)).toEqual({
    since: "2026-11-07T09:00:00Z",
    until: "2026-11-07T15:42:09Z",
  })
  expect(timeRange({ until: "2026-11-07T09:00:00Z" }, NOW)).toEqual({
    since: "2026-11-06T09:00:00Z",
    until: "2026-11-07T09:00:00Z",
  })
})

test("timeRange reads a date as the start of that day for since and the end of it for until", () => {
  expect(timeRange({ since: "2026-11-01", until: "2026-11-01" }, NOW)).toEqual({
    since: "2026-11-01T00:00:00Z",
    until: "2026-11-02T00:00:00Z",
  })
  expect(timeRange({ since: "2026-12-30", until: "2026-12-31" }, NOW).until).toBe("2027-01-01T00:00:00Z")
  expect(timeRange({ since: "2028-02-28", until: "2028-02-29" }, NOW).until).toBe("2028-03-01T00:00:00Z")
  expect(timeRange({ since: "2026-02-28T23:59:59Z", until: "2026-03-01T00:00:00Z" }, NOW)).toEqual({
    since: "2026-02-28T23:59:59Z",
    until: "2026-03-01T00:00:00Z",
  })
})

test("timeRange takes 31 days and refuses one second more", () => {
  expect(timeRange({ since: "2026-10-01", until: "2026-10-31" }, NOW)).toEqual({
    since: "2026-10-01T00:00:00Z",
    until: "2026-11-01T00:00:00Z",
  })
  expect(TIME_RANGE.maxDays).toBe(31)
  expectInvalid(
    () => timeRange({ since: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:01Z" }, NOW),
    "this report reads at most 31 days at once.",
  )
  expectInvalid(
    () => timeRange({ since: "2026-10-01", until: "2026-11-01" }, NOW),
    "this report reads at most 31 days at once.",
  )
})

test("timeRange refuses a since that is not before until", () => {
  const message = "`since` must be before `until`."
  expectInvalid(() => timeRange({ since: "2026-11-05T10:00:00Z", until: "2026-11-05T10:00:00Z" }, NOW), message)
  expectInvalid(() => timeRange({ since: "2026-11-05T10:00:01Z", until: "2026-11-05T10:00:00Z" }, NOW), message)
  expectInvalid(() => timeRange({ since: "2026-11-08T00:00:00Z" }, NOW), message)
})

test("timeRange refuses other forms and impossible dates and times, naming the argument", () => {
  const form = "must be a UTC date (2026-11-01) or a UTC time (2026-11-01T09:00:00Z)."
  for (const bad of [...BAD_FORMS, ...IMPOSSIBLE]) {
    expectInvalid(() => timeRange({ since: bad }, NOW), `\`since\` ${form}`)
    expectInvalid(() => timeRange({ until: bad }, NOW), `\`until\` ${form}`)
  }
})

test("a leap day is real in 2028 and not in 2026", () => {
  expect(dayRange({ since: "2028-02-29", until: "2028-02-29" }, NOW).until).toBe("2028-02-29")
  expect(timeRange({ since: "2028-02-29T12:00:00Z", until: "2028-03-01T00:00:00Z" }, NOW).since).toBe(
    "2028-02-29T12:00:00Z",
  )
  expectInvalid(
    () => dayRange({ since: "2026-02-29" }, NOW),
    "`since` must be a UTC date (2026-11-01) or a UTC time (2026-11-01T09:00:00Z).",
  )
})
