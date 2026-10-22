import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSchedule } from '../utils/scheduleValidator.util.js'
import { DAYS, entry, lesson, makeSettings } from './fixtures.js'

test('validator accepts a valid full-week schedule', () => {
  const lessons = ['A', 'B', 'C', 'D', 'E'].map((s, i) => lesson('S1', s, `T${i}`, 5))
  const entries = DAYS.flatMap((day) =>
    ['A', 'B', 'C', 'D', 'E'].map((s, i) => entry('S1', s, `T${i}`, day, i + 1))
  )
  const violations = validateSchedule({ settings: makeSettings(), lessons, entries })
  assert.deepEqual(violations, [])
})

test('validator flags a section double-booking', () => {
  const lessons = [lesson('S1', 'A', 'T1', 5), lesson('S1', 'B', 'T2', 5)]
  const entries = [
    entry('S1', 'A', 'T1', 'monday', 1),
    entry('S1', 'B', 'T2', 'monday', 1),
  ]
  const codes = validateSchedule({ settings: makeSettings(), lessons, entries }).map((v) => v.code)
  assert.ok(codes.includes('SECTION_SLOT_CONFLICT'))
})

test('validator flags a teacher double-booking across sections', () => {
  const lessons = [lesson('S1', 'A', 'T1', 5), lesson('S2', 'B', 'T1', 5)]
  const entries = [
    entry('S1', 'A', 'T1', 'monday', 1),
    entry('S2', 'B', 'T1', 'monday', 1),
  ]
  const codes = validateSchedule({ settings: makeSettings(), lessons, entries }).map((v) => v.code)
  assert.ok(codes.includes('TEACHER_SLOT_CONFLICT'))
})

test('validator treats a double as a single per-day occurrence', () => {
  const lessons = [lesson('S1', 'A', 'T1', 4, 'required')]
  const entries = [
    entry('S1', 'A', 'T1', 'monday', 1, 'g1'),
    entry('S1', 'A', 'T1', 'monday', 2, 'g1'),
    entry('S1', 'A', 'T1', 'tuesday', 1),
    entry('S1', 'A', 'T1', 'wednesday', 1),
  ]
  const violations = validateSchedule({ settings: makeSettings(), lessons, entries })
  assert.deepEqual(violations, [])
})

test('validator flags two singles of a subject on the same day', () => {
  const lessons = [lesson('S1', 'A', 'T1', 3)]
  const entries = [
    entry('S1', 'A', 'T1', 'monday', 1),
    entry('S1', 'A', 'T1', 'monday', 2),
  ]
  const codes = validateSchedule({ settings: makeSettings(), lessons, entries }).map((v) => v.code)
  assert.ok(codes.includes('SUBJECT_DAY_LIMIT'))
})

test('validator flags a required double that is fully placed but missing', () => {
  const lessons = [lesson('S1', 'A', 'T1', 2, 'required')]
  const entries = [entry('S1', 'A', 'T1', 'monday', 1), entry('S1', 'A', 'T1', 'tuesday', 1)]
  const codes = validateSchedule({ settings: makeSettings(), lessons, entries }).map((v) => v.code)
  assert.ok(codes.includes('REQUIRED_DOUBLE_MISSING'))
})

test('validator treats a shortfall as unplaced, not a violation', () => {
  const lessons = [lesson('S1', 'A', 'T1', 5)]
  const entries = [entry('S1', 'A', 'T1', 'monday', 1)]
  const violations = validateSchedule({ settings: makeSettings(), lessons, entries })
  assert.deepEqual(violations, [])
})

test('validator enforces the teacher consecutive cap', () => {
  const settings = makeSettings({ maximumConsecutivePeriods: 2, periodsPerDay: 6, groups: [6] })
  const lessons = [
    lesson('S1', 'A', 'T1', 1),
    lesson('S2', 'A', 'T1', 1),
    lesson('S3', 'A', 'T1', 1),
  ]
  // Three consecutive periods for T1 on monday.
  const entries = [
    entry('S1', 'A', 'T1', 'monday', 1),
    entry('S2', 'A', 'T1', 'monday', 2),
    entry('S3', 'A', 'T1', 'monday', 3),
  ]
  const codes = validateSchedule({ settings, lessons, entries }).map((v) => v.code)
  assert.ok(codes.includes('TEACHER_CONSECUTIVE'))
})
