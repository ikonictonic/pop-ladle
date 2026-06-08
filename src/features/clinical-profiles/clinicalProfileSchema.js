export const CLINICAL_PROFILE_SECTIONS = [
  {
    key: 'identity',
    label: 'Identity',
    defaultValue: {
      preferredName: '',
      ageRange: '',
      relationshipToCaregiver: '',
      livingContext: '',
    },
  },
  {
    key: 'caregiverContext',
    label: 'Caregiver Context',
    defaultValue: {
      primaryCaregiver: '',
      otherCaregivers: [],
      caregiverNotes: '',
    },
  },
  {
    key: 'diagnoses',
    label: 'Diagnoses',
    defaultValue: [],
  },
  {
    key: 'medications',
    label: 'Medications',
    defaultValue: [],
  },
  {
    key: 'dailyLimits',
    label: 'Daily Limits',
    defaultValue: {
      sodiumMg: null,
      potassiumMg: null,
      phosphorusMg: null,
      fluidMl: null,
      proteinG: null,
      carbohydrateG: null,
    },
  },
  {
    key: 'levodopaProteinTiming',
    label: 'Levodopa And Protein Timing',
    defaultValue: {
      medicationWindows: [],
      proteinWindows: [],
      notes: '',
    },
  },
  {
    key: 'hydrationRules',
    label: 'Hydration Rules',
    defaultValue: {
      dailyGoalMl: null,
      preferredDrinks: [],
      resistedFluids: [],
      timingNotes: '',
    },
  },
  {
    key: 'renalControls',
    label: 'Renal Controls',
    defaultValue: {
      potassiumControls: [],
      phosphorusControls: [],
      binderTimingNotes: '',
      renalDietitianNotes: '',
    },
  },
  {
    key: 'cardiacBloodPressure',
    label: 'Cardiac And Blood Pressure',
    defaultValue: {
      sodiumNotes: '',
      fluidNotes: '',
      bloodPressureConcerns: [],
      cardiacNotes: '',
    },
  },
  {
    key: 'bleedingInfectionSafety',
    label: 'Bleeding And Infection Safety',
    defaultValue: {
      bleedingRisks: [],
      infectionRisks: [],
      foodSafetyNotes: '',
    },
  },
  {
    key: 'allergiesSensitivities',
    label: 'Allergies And Sensitivities',
    defaultValue: {
      allergies: [],
      sensitivities: [],
      intolerances: [],
    },
  },
  {
    key: 'tasteTriggers',
    label: 'Taste Triggers',
    defaultValue: {
      metallicTasteTriggers: [],
      dislikedSmells: [],
      helpfulFlavors: [],
    },
  },
  {
    key: 'textureEatingNeeds',
    label: 'Texture And Eating Needs',
    defaultValue: {
      textureNeeds: [],
      chewingSwallowingNotes: '',
      tremorNeeds: [],
      mealFatigueNotes: '',
    },
  },
  {
    key: 'appetiteModes',
    label: 'Appetite Modes',
    defaultValue: {
      strongDay: '',
      neutralDay: '',
      lowIntakeDay: '',
    },
  },
  {
    key: 'mealSnackRhythm',
    label: 'Meal And Snack Rhythm',
    defaultValue: {
      meals: [],
      snacks: [],
      bestEatingWindows: [],
      timingNotes: '',
    },
  },
  {
    key: 'validatedFoods',
    label: 'Validated Foods',
    defaultValue: [],
  },
  {
    key: 'foodsToLimit',
    label: 'Foods To Limit',
    defaultValue: [],
  },
  {
    key: 'kitchenExecutionLimits',
    label: 'Kitchen Execution Limits',
    defaultValue: {
      prepTimeMinutes: null,
      equipmentLimits: [],
      shoppingLimits: [],
      batchCookingNeeds: [],
      caregiverNotes: '',
    },
  },
  {
    key: 'goals',
    label: 'Goals',
    defaultValue: [],
  },
]

export const CLINICAL_PROFILE_SECTION_KEYS = CLINICAL_PROFILE_SECTIONS.map((section) => section.key)

export function createEmptyClinicalProfileData() {
  return CLINICAL_PROFILE_SECTIONS.reduce((profileData, section) => {
    profileData[section.key] = structuredClone(section.defaultValue)
    return profileData
  }, {})
}
