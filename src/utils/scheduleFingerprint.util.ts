/**
 * scheduleFingerprint.util.ts
 *
 * Deterministic fingerprint of the data a schedule was generated from. Storing
 * it on the schedule lets later phases detect when the underlying settings,
 * requirements or assignments have drifted since generation.
 *
 * Uses a stable, key-sorted stringify so identical data always hashes the same
 * regardless of property insertion order.
 */

import { createHash } from 'node:crypto'

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function computeScheduleFingerprint(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex')
}
