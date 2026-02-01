
export const recalcResult = async (
  scoreDoc: any,
  conducted: any,
  setup: any
): Promise<void> => {
  const populatedTypes = setup.assessmentTypeIds as any[]
  let weightedSum = 0

  scoreDoc.scores.forEach((scoreItem: any) => {
    if (
      conducted.conductedStages.some((id: any) =>
        id.equals(scoreItem.assessmentTypeId)
      )
    ) {
      const type = populatedTypes.find((t: any) =>
        t._id.equals(scoreItem.assessmentTypeId)
      )

      if (type) {
        weightedSum += (scoreItem.score * type.weight) / 100
      }
    }
  })

  scoreDoc.result = Math.round(weightedSum * 100) / 100
}


export const validateConducted = (
  conducted: any,
  assessmentTypeId: any,
  typeName?: string
): void => {
  const isConducted = conducted.conductedStages.some((id: any) =>
    id.equals(assessmentTypeId)
  )

  if (!isConducted) {
    const message = typeName
      ? `Mark "${typeName}" conducted first!`
      : "Mark this stage conducted first!"
    throw new Error(message)
  }
}
