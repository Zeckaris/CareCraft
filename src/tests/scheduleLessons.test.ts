import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLessons, buildValidationSettings } from '../utils/scheduleLessons.util.js'
import { pickScheduleSettingData } from '../utils/scheduleSetting.util.js'

const settingDoc = {
  schoolYear: '2025-2026',
  enabledDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  bellSchedule: {
    startTime: '08:00',
    blocks: [
      { type: 'period', durationMinutes: 45 },
      { type: 'period', durationMinutes: 45 },
      { type: 'period', durationMinutes: 45 },
      { type: 'break', durationMinutes: 15 },
      { type: 'period', durationMinutes: 45 },
      { type: 'period', durationMinutes: 45 },
    ],
  },
  minimumFreePeriodsPerDay: 1,
  maximumWeeklyTaughtPeriods: null,
  maximumConsecutivePeriods: null,
}

test('buildValidationSettings derives per-day layout', () => {
  const settings = buildValidationSettings(pickScheduleSettingData(settingDoc))
  assert.equal(settings.enabledDays.length, 5)
  assert.equal(settings.perDay[0].periodsPerDay, 5)
  assert.deepEqual(settings.perDay[0].groups, [3, 2])
  assert.equal(settings.perDay[0].dailyTeachingCap, 4)
})

test('buildLessons materialises a lesson per complete assignment', () => {
  const lessons = buildLessons({
    sections: [{ _id: 'S1', gradeId: 'G1' }],
    requirements: [
      { gradeId: 'G1', subjectId: 'A', periodsPerWeek: 4, doublePeriod: 'required' },
      { gradeId: 'G1', subjectId: 'B', periodsPerWeek: 3, doublePeriod: 'none' },
    ],
    assignments: [
      { _id: 'TA1', sectionId: 'S1', teacherId: 'T1', subjectId: 'A', role: 'subject' },
      { _id: 'TA2', sectionId: 'S1', teacherId: 'T2', subjectId: 'B', role: 'subject' },
    ],
  })
  assert.equal(lessons.length, 2)
  const a = lessons.find((l) => l.subjectId === 'A')!
  assert.equal(a.periodsPerWeek, 4)
  assert.equal(a.doublePeriod, 'required')
  assert.equal(a.teacherId, 'T1')
})

test('buildLessons skips subjects without exactly one assignment', () => {
  const lessons = buildLessons({
    sections: [{ _id: 'S1', gradeId: 'G1' }],
    requirements: [
      { gradeId: 'G1', subjectId: 'A', periodsPerWeek: 4, doublePeriod: 'none' },
      { gradeId: 'G1', subjectId: 'B', periodsPerWeek: 3, doublePeriod: 'none' },
    ],
    assignments: [
      { _id: 'TA1', sectionId: 'S1', teacherId: 'T1', subjectId: 'A', role: 'subject' },
      { _id: 'TA2', sectionId: 'S1', teacherId: 'T2', subjectId: 'A', role: 'subject' },
    ],
  })
  assert.equal(lessons.length, 0)
})
