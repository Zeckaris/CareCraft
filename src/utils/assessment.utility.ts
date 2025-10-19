
export const recalcResult = async (scoreDoc: any, gsa: any, setup: any): Promise<void> => {
    const populatedTypes = setup.assessmentTypeIds as any[]
    let weightedSum = 0
    
    scoreDoc.scores.forEach((scoreItem: any) => {
        if (gsa.conductedStages.includes(scoreItem.assessmentTypeId)) {
            const type = populatedTypes.find(t => t._id.equals(scoreItem.assessmentTypeId))
            weightedSum += (scoreItem.score * type.weight) / 100
        }
    })
    
    scoreDoc.result = Math.round(weightedSum * 100) / 100
}

export const validateConducted = (gsa: any, assessmentTypeId: any, typeName?: string): void => {
    if (!gsa.conductedStages.includes(assessmentTypeId)) {
        const message = typeName 
            ? `Mark "${typeName}" conducted first!`
            : "Mark this stage conducted first!"
        throw new Error(message) 
    }
}