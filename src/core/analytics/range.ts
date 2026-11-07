import { z } from "zod"
import { ToolError } from "../errors"

/** What a caller may pass as `since` / `until`. */
export const rangeBoundArg = z.string().describe("A UTC date (2026-11-01) or a UTC time (2026-11-01T09:00:00Z).")

/** A span of whole UTC days, as "YYYY-MM-DD"; both ends are included. */
export type DayRange = { since: string; until: string }

/** A span of UTC time, as "YYYY-MM-DDTHH:MM:SSZ"; `since` is included, `until` is excluded. */
export type TimeRange = { since: string; until: string }

/** The day-based range: the default length and the longest span, in days. */
export const DAY_RANGE = { defaultDays: 7, maxDays: 366 }

/** The time-based range: the default length in hours and the longest span, in days. */
export const TIME_RANGE = { defaultHours: 24, maxDays: 31 }

const MS_PER_SECOND = 1000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000
const DATE_LENGTH = 10
const TIME_LENGTH = 19

const DATE_FORM = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_FORM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/

type RangeArgs = { since?: string; until?: string }
type BoundName = "since" | "until"
type Bound = { ms: number; isDate: boolean }

function invalid(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

function parseBound(value: string, name: BoundName): Bound {
  const parts = (DATE_FORM.exec(value) ?? TIME_FORM.exec(value))?.slice(1).map(Number)
  if (parts) {
    const [year, month, day, hour = 0, minute = 0, second = 0] = parts
    const ms = Date.UTC(year!, month! - 1, day!, hour, minute, second)
    const date = new Date(ms)
    // Date.UTC rolls an impossible date over (02-30 becomes 03-02), so a round trip tells a real one.
    const real =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day &&
      date.getUTCHours() === hour &&
      date.getUTCMinutes() === minute &&
      date.getUTCSeconds() === second
    if (real) return { ms, isDate: DATE_FORM.test(value) }
  }
  throw invalid(`\`${name}\` must be a UTC date (2026-11-01) or a UTC time (2026-11-01T09:00:00Z).`)
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, DATE_LENGTH)
}

function formatTime(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, TIME_LENGTH)}Z`
}

function dayBound(value: string, name: BoundName): number {
  const bound = parseBound(value, name)
  if (!bound.isDate) throw invalid(`\`${name}\` must be a date (2026-11-01): traffic counts whole UTC days.`)
  return bound.ms
}

function timeBound(value: string, name: BoundName): number {
  const bound = parseBound(value, name)
  return bound.isDate && name === "until" ? bound.ms + MS_PER_DAY : bound.ms
}

/** Resolves `since` / `until` to whole UTC days: today and the six days before it by default. */
export function dayRange(args: RangeArgs, now: Date): DayRange {
  const until =
    args.until === undefined ? Math.floor(now.getTime() / MS_PER_DAY) * MS_PER_DAY : dayBound(args.until, "until")
  const since =
    args.since === undefined ? until - (DAY_RANGE.defaultDays - 1) * MS_PER_DAY : dayBound(args.since, "since")
  if (since > until) throw invalid("`since` must not be after `until`.")
  if ((until - since) / MS_PER_DAY + 1 > DAY_RANGE.maxDays) {
    throw invalid(`traffic reads at most ${DAY_RANGE.maxDays} days at once.`)
  }
  return { since: formatDate(since), until: formatDate(until) }
}

/** Resolves `since` / `until` to UTC times: the last 24 hours by default. A date as `until` means the end of that day. */
export function timeRange(args: RangeArgs, now: Date): TimeRange {
  const until =
    args.until === undefined
      ? Math.floor(now.getTime() / MS_PER_SECOND) * MS_PER_SECOND
      : timeBound(args.until, "until")
  const since =
    args.since === undefined ? until - TIME_RANGE.defaultHours * MS_PER_HOUR : timeBound(args.since, "since")
  if (since >= until) throw invalid("`since` must be before `until`.")
  if (until - since > TIME_RANGE.maxDays * MS_PER_DAY) {
    throw invalid(`this report reads at most ${TIME_RANGE.maxDays} days at once.`)
  }
  return { since: formatTime(since), until: formatTime(until) }
}
