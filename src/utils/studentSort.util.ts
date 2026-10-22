export type StudentNameFields = {
  firstName?: unknown
  lastName?: unknown
  _id?: unknown
  id?: unknown
  studentId?: unknown
}

const studentNameCollator = new Intl.Collator(['en', 'am'], {
  sensitivity: 'base',
  numeric: true,
})

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function studentIdOf(value: any): string {
  const id = value?._id ?? value?.studentId?._id ?? value?.studentId ?? value?.id
  return id === undefined || id === null ? '' : String(id)
}

export function compareStudentNames(
  a: StudentNameFields | null | undefined,
  b: StudentNameFields | null | undefined
): number {
  const aFirst = text(a?.firstName)
  const aLast = text(a?.lastName)
  const bFirst = text(b?.firstName)
  const bLast = text(b?.lastName)
  const aMissing = !aFirst || !aLast
  const bMissing = !bFirst || !bLast

  if (aMissing !== bMissing) return aMissing ? 1 : -1

  const byFirstName = studentNameCollator.compare(aFirst, bFirst)
  if (byFirstName !== 0) return byFirstName

  const byLastName = studentNameCollator.compare(aLast, bLast)
  if (byLastName !== 0) return byLastName

  return studentIdOf(a).localeCompare(studentIdOf(b))
}

export function sortByStudentName<T>(
  items: T[],
  getStudent: (item: T) => StudentNameFields | null | undefined = (item) =>
    item as unknown as StudentNameFields
): T[] {
  return [...items].sort((a, b) =>
    compareStudentNames(getStudent(a), getStudent(b))
  )
}
