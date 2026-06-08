// =============================================================================
// sourcePack.js  (ported verbatim from frontend constants/clinicalSourcePack.js)
// Static summary references for display/context. No deps.
// =============================================================================

export const CLINICAL_SOURCE_PACK = [
  {
    id: 'NKF_SODIUM_CKD',
    name: 'National Kidney Foundation sodium guidance for CKD',
    summary:
      'CKD meal planning often uses sodium limits set by the care team. Sodium load matters for kidney disease, cardiovascular disease, and blood pressure.',
  },
  {
    id: 'NKF_POTASSIUM_CKD',
    name: 'National Kidney Foundation potassium guidance for CKD',
    summary:
      'Potassium limits are individualized and lab-driven. Portion size matters because many foods contain potassium.',
  },
  {
    id: 'PARKINSON_LEVODOPA_PROTEIN',
    name: "Parkinson's Foundation levodopa and protein timing guidance",
    summary:
      'Protein can reduce levodopa benefit in some patients. Timing meals after dosing can help when protein response is an issue.',
  },
  {
    id: 'FDA_USDA_FOOD_SAFETY',
    name: 'FDA and USDA safe cooking temperature guidance',
    summary:
      'Older or immune-compromised patients need careful food handling and fully cooked proteins. Poultry should reach 165 degF. Fish should reach 145 degF. Ground meats should reach 160 degF.',
  },
  {
    id: 'LOKELMA_LABEL_CONTEXT',
    name: 'Lokelma prescribing information context',
    summary:
      'Lokelma is used for hyperkalemia management. Potassium load and sodium context matter for patients with kidney disease or cardiovascular risk.',
  },
  {
    id: 'BRUKINSA_SAFETY_CONTEXT',
    name: 'Brukinsa prescribing information context',
    summary:
      'Brukinsa can increase infection and bleeding concerns. Food safety, clean prep, and fully cooked proteins matter.',
  },
]

export function formatClinicalSourcePack(pack = CLINICAL_SOURCE_PACK) {
  return pack
    .map(
      (entry) =>
        `- ID: ${entry.id}\n  Name: ${entry.name}\n  Summary: ${entry.summary}`,
    )
    .join('\n')
}
