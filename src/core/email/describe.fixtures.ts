import type { FakeRequest } from "../cloudflare/testing"

export { confirming, describing, refusing } from "../describe.fixtures"

/** The requests that are not reads. */
export function writes(requests: FakeRequest[]): string[] {
  return requests.filter((request) => request.method !== "GET").map((request) => `${request.method} ${request.path}`)
}

/** How many reads of `path` the fake received. */
export function readsOf(requests: FakeRequest[], path: string): number {
  return requests.filter((request) => request.method === "GET" && request.path === path).length
}
