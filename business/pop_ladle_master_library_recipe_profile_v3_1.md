# Pop & Ladle Master Library Recipe Profile

Version: 3.1  
Scope: Super Admin recipe generation, Master Library recipe records, internal Clinical Review packet, flag catalog  
Primary purpose: Create reusable senior-care recipe records that carry structured metadata for later household adaptation.

## Core Rule

The Master Library creates reusable recipe records.

The Master Library produces generally healthy, senior-compatible, clinically review-ready recipe records. Final person-level clinical fit is determined downstream by the household care profile, active modules, nutrition verification, and Clinical Review.

The Master Library records recipe facts, nutrition data, preparation behavior, ingredient behavior, clinical review flags, substitution logic, caregiver execution notes, and audit metadata.

The Master Library treats clinical and nutrition concerns as structured flags.

The household care profile interprets those flags against the actual person.

The Clinical Review workflow reviews the recipe record, flags, nutrition confidence, substitution logic, and release status.


## External Verification Boundary

The Master Library Recipe Profile does not call external APIs.

External APIs are handled by dedicated system services.

The Master Library may store verified results returned by those services.

External service outputs may include:

- Nutrition values.
- Food database identifiers.
- Ingredient match confidence.
- ICD-10-CM condition codes.
- Medication identifiers.
- Medication class identifiers.
- Terminology source.
- Verification status.
- Last verified date.

The Master Library uses these returned values as structured data.

API endpoints, API keys, request logic, response parsing, retry logic, rate limits, terminology mapping, and source-specific implementation belong in service specifications, not in this recipe profile.


## Output Separation Rule

The Master Library Recipe Profile creates the complete internal recipe record.

The full Master Library record is not the caregiver-facing output.

The caregiver-facing output must be generated as a separate compact recipe card after Master Library generation, nutrition lookup, flagging, household adaptation, and Clinical Review.

By default, never show the full Flag Packet, Clinical Review Packet, audit notes, model trace, nutrition confidence detail, downstream module candidates, or review routing language to caregivers.

Caregiver-facing output should show only:

- Recipe title.
- Short meal summary.
- Time.
- Servings.
- Difficulty.
- Ingredients.
- Steps.
- What done looks like.
- Simple substitutions.
- Household-safe care notes.
- Approval status.

Clinical and flag details may appear behind a “Details,” “Why this fits,” or “Clinical Review” panel based on user role and permissions.

Super Admin sees the full record.

Care Team sees the clinical packet.

Household Owner may see simplified fit notes.

Caregiver sees the cooking card.

Viewer sees the released recipe only.


## Master Library Healthy Base Defaults

Use these defaults when creating Master Library recipes.

These defaults create a broadly healthy recipe base. Person-level targets, exclusions, restrictions, provider orders, and disease-specific logic belong downstream.

Default recipe design:

- Use recognizable whole-food ingredients when practical.
- Use clear serving sizes.
- Use measured salt and measured high-impact condiments.
- Favor unsaturated fats when the recipe needs added fat.
- Favor lean proteins, seafood, eggs, dairy, beans, legumes, tofu, or other culturally appropriate protein choices based on the recipe concept.
- Use vegetables, fruit, grains, starches, or legumes in portions that can be flagged and adjusted downstream.
- Use added sugar intentionally and in measured amounts.
- Use sauces for moisture, appetite, and flavor control.
- Use safe cooking temperatures where relevant.
- Use batch, leftover, freezer, or rescue-meal paths when practical.
- Preserve cultural identity and comfort-food logic where possible.
- Preserve flavor first, then tag clinical review candidates through flags.

Default recipe behavior:

- Record nutrition values per serving.
- Record ingredient-level nutrition confidence.
- Record mineral and electrolyte data when available.
- Record vitamin and micronutrient data when available.
- Record macronutrient and energy data.
- Record food safety handling.
- Record texture behavior.
- Record appetite and sensory behavior.
- Record caregiver execution burden.
- Record substitution paths when useful.
- Record review lanes through flags.

## System Boundaries

### Master Library Recipe Generation

Use this layer for:

- Top-level recipe creation.
- Source recipe adaptation into a reusable senior-care recipe.
- Ingredient normalization.
- Serving normalization.
- Nutrition snapshot.
- Flag packet creation.
- Substitution record.
- Texture tags.
- Flavor strategy tags.
- Caregiver execution tags.
- Internal Clinical Review routing.
- Master Library release status.

### Household Care Profile Service

The household care profile service handles person-level interpretation.

Reserved downstream data classes:

- Personal identifiers.
- Household members.
- Exact medications and medication schedules.
- Active diagnosis logic.
- Provider orders.
- Lab-driven targets.
- Daily nutrient ceilings.
- Daily nutrient floors.
- Condition-specific food rules.
- Medication-specific food timing.
- Supplement-specific food timing.
- Exact daily mineral and electrolyte targets from a specific person.
- Exact dietary balance targets and health goals for a specific person.
- Personal beverage routines.
- Personal taste triggers.
- Validated foods for one person.
- Current appetite mode.
- Current chewing needs.
- Current swallowing needs.
- Current caregiver capacity.
- Current shopping pattern.
- Current equipment limits.

### Clinical Review Workflow

Use this layer for:

- Review queue.
- Approval.
- Approval with caveats.
- Denial.
- Dietitian review.
- Clinician confirmation.
- Model trace.
- Audit notes.
- Nutrition verification.
- Ingredient risk review.
- Substitution review.
- Final release status.

Clinical Review output may reference activated flags, review lanes, caveats, and release status.

Clinical Review output may use internal language.

Caregiver-facing recipe copy stays plain, practical, and meal-focused.

## Master Library Output Includes

Every Master Library recipe should include the following sections.

### Recipe Identity

Include:

- Recipe title.
- Recipe format.
- Meal slot.
- Cuisine or cultural inspiration.
- Serving count.
- Yield.
- Prep time.
- Cook time.
- Total time.
- Batch potential.
- Leftover potential.
- Freezer potential.
- Source type.
- Source notes.
- Version label.
- Created date.
- Updated date.
- Review status.

### Recipe Summary

Include:

- Plain-language recipe description.
- Intended meal use.
- General senior-care fit in plain food language.
- Main protein or core ingredient.
- Main starch or base.
- Main vegetable or fruit components.
- Main sauce or flavor base.
- Texture summary.
- Caregiver practicality summary.

Keep the summary generic and reusable.

### Ingredient Loadout

Include:

- Ingredient name.
- Amount.
- Unit.
- Preparation state.
- Optional status.
- Ingredient role.
- Substitution candidate.
- Nutrition lookup status.
- Allergen flag candidate.
- Flag trigger candidate.

Ingredient roles may include:

- Base.
- Protein.
- Vegetable.
- Fruit.
- Sauce.
- Fat.
- Acid.
- Herb.
- Spice.
- Binder.
- Crunch.
- Garnish.
- Fluid.
- Fortified food.
- Packaged ingredient.
- High-impact condiment.

### Execution Steps

Include:

- Clear steps.
- Home-kitchen language.
- Food safety temperatures when needed.
- Make-ahead steps when useful.
- Batch storage steps when useful.
- Reheating steps when useful.
- Texture control steps when useful.
- Flavor control steps when useful.

### What Done Looks Like

Include:

- Visual cue.
- Texture cue.
- Aroma cue.
- Temperature cue.
- Doneness cue.
- Plating cue.

### Nutrition Snapshot

Include verified values when available.

Include estimated values when lookup remains pending.

Use per serving as the default basis.

Include:

- Calories.
- Protein.
- Carbohydrates.
- Total fat.
- Saturated fat.
- Fiber.
- Added sugar.
- Sodium.
- Potassium.
- Phosphorus when available.
- Calcium when available.
- Magnesium when available.
- Iron when available.
- Zinc when available.
- Selenium when available.
- Vitamin A when available.
- Vitamin C when available.
- Vitamin D when available.
- Vitamin E when available.
- Vitamin K when available.
- Folate when available.
- Vitamin B12 when available.
- Fluid contribution when available.

Nutrition snapshot must include:

- Data source.
- Lookup confidence.
- Portion basis.
- Ingredient match quality.
- Verification status.
- Last updated date.

### Substitution Log

Use when ingredients are removed, reduced, swapped, or added.

Include:

- Original ingredient.
- Replacement ingredient.
- Reason category.
- Recipe impact.
- Flavor impact.
- Texture impact.
- Nutrition impact.
- Flag impact.
- Review lane.

Reason categories:

- Allergen.
- Restriction.
- Mineral or electrolyte load.
- Vitamin or micronutrient load.
- Macronutrient balance.
- Medication candidate.
- Food safety.
- Texture.
- Appetite.
- Caregiver execution.
- Shopping practicality.
- Cultural fit.
- Flavor repair.
- Cost.
- Batch use.

### Texture Tags

Use texture tags as recipe facts.

Texture can be positive, neutral, or review-worthy depending on the person.

Tags:

- Soft.
- Tender.
- Moist.
- Saucy.
- Crisp.
- Crunchy.
- Crumbly.
- Sticky.
- Dry.
- Stringy.
- Mixed texture.
- Bite-sized.
- Spoonable.
- Handheld.
- Smooth.
- Thick.
- Thin.
- Warm.
- Cool.
- Room temperature.

### Flavor Strategy Tags

Use flavor tags as recipe craft metadata.

Flavor meaning belongs to household preference and day-level appetite logic.

Tags:

- Browning.
- Searing.
- Toasting.
- Acid balance.
- Fresh herbs.
- Dry spices.
- Aromatics.
- Umami source.
- Texture contrast.
- Finishing oil.
- Sauce-based flavor.
- Comfort cue.
- Low-sodium flavor strategy.
- Low-sugar flavor strategy.
- Low-fat flavor strategy.
- Mild flavor.
- Bold flavor.
- Aroma-forward.
- Bright flavor.
- Savory flavor.
- Sweet-forward.
- Bitter note.
- Spicy heat.

### Caregiver Execution Notes

Include:

- Skill level.
- Active cooking time.
- Passive cooking time.
- Step count.
- Tool burden.
- Cleanup burden.
- Shopping burden.
- Batch potential.
- Freezer potential.
- Leftover path.
- Rescue-meal use.
- Common failure points.
- Shortcuts.

### Pairing Candidates

Include simple pairings.

Pairing candidates should carry flags.

Examples of pairing categories:

- Fluid pairing.
- Vegetable side.
- Fruit side.
- Starch side.
- Protein side.
- Sauce.
- Dessert.
- Snack.

### Variation Candidates

Include variation ideas when useful.

Variation candidates should carry flags.

Examples:

- Bowl.
- Soup.
- Wrap.
- Sandwich.
- Omelet.
- Frittata.
- Casserole.
- Soft plate.
- Handheld.
- Batch version.
- Freezer version.
- Lower-prep version.

### Clinical Review Packet

Include:

- Review status.
- Review lanes triggered.
- Flag packet.
- Nutrition confidence.
- Ingredient risk checks.
- Substitution logic.
- Caveat candidates.
- Release recommendation.
- Audit notes.
- Model trace summary.
- Reviewer notes field.

## Review Status Values

Use these statuses:

- DRAFT.
- NUTRITION_LOOKUP_PENDING.
- NEEDS_NUTRITION_REVIEW.
- NEEDS_CLINICAL_REVIEW.
- APPROVED_FOR_MASTER_LIBRARY.
- APPROVED_WITH_CAVEATS.
- DENIED_FOR_MASTER_LIBRARY.
- HOLD_FOR_SOURCE_REVIEW.
- RELEASED_TO_MASTER_LIBRARY.

## Flag Catalog

Use flags as structured recipe metadata.

The Master Library identifies what the recipe contains, how it behaves, what may require review, and what downstream modules may evaluate.

The Master Library creates the flag packet.

The household care profile interprets the flag packet.

The Clinical Review workflow approves, caveats, denies, or releases the recipe record.

Return triggered flags only.

Each flag should include:

- Flag code.
- Flag class.
- Triggering ingredient or recipe feature.
- Measured value when verified.
- Estimated value when verification remains pending.
- Portion basis.
- Confidence level.
- Review lane.
- Downstream module candidate.
- Class-specific fields when applicable.

Use this structure:

```json
{
  "flag_code": "",
  "flag_class": "",
  "trigger": "",
  "ingredient_or_component": "",
  "value": "",
  "unit": "",
  "portion_basis": "",
  "confidence": "",
  "review_lane": "",
  "downstream_module_candidate": "",
  "class_specific_fields": {}
}
```

### Standard Confidence Values

Use these values:

- VERIFIED.
- ESTIMATED_HIGH_CONFIDENCE.
- ESTIMATED_MEDIUM_CONFIDENCE.
- ESTIMATED_LOW_CONFIDENCE.
- PENDING_LOOKUP.
- NEEDS_MANUAL_REVIEW.

### Standard Review Lane Values

Use these values:

- REVIEW_NUTRITION_DATA.
- REVIEW_MINERALS_ELECTROLYTES.
- REVIEW_VITAMINS_MICRONUTRIENTS.
- REVIEW_MACRONUTRIENTS.
- REVIEW_FLUID_HYDRATION.
- REVIEW_MEDICATION_SUPPLEMENT.
- REVIEW_FOOD_SAFETY.
- REVIEW_TEXTURE_SWALLOWING.
- REVIEW_APPETITE_SENSORY.
- REVIEW_ALLERGEN_RESTRICTION.
- REVIEW_CAREGIVER_EXECUTION.
- REVIEW_CULTURAL_HOUSEHOLD_FIT.
- REVIEW_SUBSTITUTION_LOGIC.
- REVIEW_HOUSEHOLD_ADAPTATION_READY.

### Standard Downstream Module Candidate Values

Use these values:

- MODULE_NUTRITION_DATA.
- MODULE_MINERALS_ELECTROLYTES.
- MODULE_VITAMINS_MICRONUTRIENTS.
- MODULE_MACRONUTRIENTS.
- MODULE_FLUID_HYDRATION.
- MODULE_MEDICATION_SUPPLEMENT.
- MODULE_FOOD_SAFETY.
- MODULE_TEXTURE_CHEWING_SWALLOWING.
- MODULE_APPETITE_SENSORY.
- MODULE_ALLERGEN_RESTRICTION.
- MODULE_CAREGIVER_EXECUTION.
- MODULE_CULTURAL_HOUSEHOLD_FIT.
- MODULE_SUBSTITUTION_LOGIC.
- MODULE_HOUSEHOLD_ADAPTATION.

## Nutrition Data Quality Flags

Use when nutrition values need lookup, verification, recalculation, serving-size review, or ingredient match review.

Codes:

- NUTRITION_LOOKUP_NEEDED.
- NUTRITION_VALUE_ESTIMATED.
- NUTRITION_VALUE_VERIFIED.
- SERVING_SIZE_REVIEW.
- PORTION_BASIS_REVIEW.
- INGREDIENT_MATCH_CONFIDENCE_LOW.
- FOOD_DATABASE_LOOKUP_PENDING.
- MANUAL_NUTRITION_REVIEW.

Class-specific fields:

- Data source.
- Lookup status.
- Ingredient match quality.
- Serving size issue.
- Portion basis issue.
- Manual review reason.

## Minerals and Electrolytes Flags

Use when minerals or electrolytes may matter based on amount, ingredient class, preparation method, concentration, serving size, fortified foods, additives, or downstream household targets.

Mineral and electrolyte keys may include:

- SODIUM.
- POTASSIUM.
- PHOSPHORUS.
- CALCIUM.
- MAGNESIUM.
- IRON.
- ZINC.
- SELENIUM.
- IODINE.
- CHLORIDE.
- COPPER.
- MANGANESE.
- FLUORIDE.
- CHROMIUM.
- MOLYBDENUM.

Codes:

- MINERAL_ELECTROLYTE_ESTIMATE_NEEDED.
- MINERAL_ELECTROLYTE_VALUE_PRESENT.
- MINERAL_ELECTROLYTE_CONCENTRATED_SOURCE.
- MINERAL_ELECTROLYTE_MULTIPLE_SOURCES.
- MINERAL_ELECTROLYTE_PORTION_DEPENDENT.
- MINERAL_ELECTROLYTE_ADDITIVE_ATTENTION.
- MINERAL_ELECTROLYTE_FORTIFIED_FOOD_ATTENTION.
- MINERAL_ELECTROLYTE_SUBSTITUTION_READY.
- MINERAL_ELECTROLYTE_REVIEW_CANDIDATE.

Class-specific fields:

- Mineral or electrolyte key.
- Source ingredient.
- Amount per serving when available.
- Amount per batch when available.
- Data confidence.
- Portion basis.
- Preparation note when preparation affects the value.

The Master Library records mineral and electrolyte data.

The household care profile interprets the data against active conditions, labs, medications, provider orders, household targets, and daily totals.

## Vitamin and Micronutrient Flags

Use when vitamins, fortified foods, nutrient-dense ingredients, nutrient gaps, or medication-relevant vitamin classes may matter downstream.

Vitamin and micronutrient keys may include:

- VITAMIN_A.
- VITAMIN_C.
- VITAMIN_D.
- VITAMIN_E.
- VITAMIN_K.
- THIAMIN.
- RIBOFLAVIN.
- NIACIN.
- VITAMIN_B6.
- FOLATE.
- VITAMIN_B12.
- BIOTIN.
- PANTOTHENIC_ACID.
- CHOLINE.
- CAROTENOIDS.
- OMEGA_3.
- OMEGA_6.

Codes:

- VITAMIN_ESTIMATE_NEEDED.
- VITAMIN_VALUE_PRESENT.
- VITAMIN_DENSE_SOURCE.
- VITAMIN_LOW_SOURCE.
- VITAMIN_PORTION_DEPENDENT.
- FAT_SOLUBLE_VITAMIN_ATTENTION.
- WATER_SOLUBLE_VITAMIN_ATTENTION.
- FORTIFIED_FOOD_ATTENTION.
- MICRONUTRIENT_REVIEW_CANDIDATE.

Class-specific fields:

- Vitamin or micronutrient key.
- Source ingredient.
- Amount per serving when available.
- Amount per batch when available.
- Data confidence.
- Portion basis.
- Preparation note when preparation affects the value.

The Master Library records vitamin and micronutrient data.

The household care profile decides relevance against active conditions, labs, medications, supplements, provider orders, household targets, and daily totals.

## Macronutrient and Energy Flags

Use when calories, protein, carbohydrate, fat, fiber, sugar, or meal density may matter downstream.

Codes:

- ENERGY_DENSE_MEAL.
- ENERGY_LIGHT_MEAL.
- PROTEIN_DENSE_MEAL.
- PROTEIN_LIGHT_MEAL.
- PROTEIN_PORTION_DEPENDENT.
- PROTEIN_TIMING_CANDIDATE.
- CARB_DENSE_MEAL.
- ADDED_SUGAR_ATTENTION.
- FAT_DENSE_MEAL.
- SATURATED_FAT_ATTENTION.
- FIBER_LOW_ATTENTION.
- FIBER_HIGH_ATTENTION.
- GLYCEMIC_REVIEW_CANDIDATE.
- MACRONUTRIENT_BALANCE_REVIEW.

Class-specific fields:

- Macronutrient key.
- Amount per serving when available.
- Amount per batch when available.
- Source ingredient or recipe component.
- Data confidence.
- Portion basis.

Use generic timing language only.

The downstream medication module interprets medication timing.

## Fluid and Hydration Flags

Use when the recipe contributes fluid, requires fluid balance review, includes fluid-heavy components, or pairs naturally with a beverage.

Codes:

- FLUID_CONTRIBUTION_PRESENT.
- HYDRATION_SUPPORT_CANDIDATE.
- FLUID_VOLUME_REVIEW.
- BROTH_BASE_ATTENTION.
- SOUP_OR_STEW_PRESENT.
- SAUCE_HEAVY_COMPONENT.
- JUICY_FRUIT_OR_VEGETABLE_PRESENT.
- FROZEN_FLUID_COMPONENT.
- BEVERAGE_PAIRING_READY.

Class-specific fields:

- Fluid source.
- Estimated fluid amount when available.
- Serving basis.
- Temperature.
- Pairing candidate.
- Data confidence.

The Master Library records fluid behavior.

The household care profile decides fluid fit against hydration goals, fluid limits, beverage preferences, swallowing needs, timing, and daily totals.

## Medication, Supplement, and Timing Candidate Flags

Use ingredient-level, nutrient-class, supplement-class, and timing-candidate flags.

Codes:

- MED_SUPPLEMENT_REVIEW_CANDIDATE.
- MED_INTERACTION_INGREDIENT_CLASS_PRESENT.
- MED_INTERACTION_NUTRIENT_CLASS_PRESENT.
- MED_INTERACTION_SUPPLEMENT_CLASS_PRESENT.
- MED_INTERACTION_FORTIFIED_FOOD_PRESENT.
- MED_INTERACTION_HIGH_PROTEIN_LOAD_PRESENT.
- MED_INTERACTION_HIGH_MINERAL_LOAD_PRESENT.
- MED_TIMING_REVIEW_CANDIDATE.
- SUPPLEMENT_TIMING_REVIEW_CANDIDATE.

Class-specific fields:

- Ingredient class.
- Nutrient class.
- Supplement class when present.
- Source ingredient or recipe component.
- Amount when available.
- Portion basis.
- Data confidence.
- Downstream medication module candidate.

The Master Library records candidate classes.

The downstream medication and supplement module maps candidates to the person’s active medication list, supplement list, provider orders, and timing rules.

## Food Safety and Immune Risk Flags

Use when preparation, temperature, storage, raw ingredients, undercooked ingredients, seafood, sprouts, dairy, eggs, leftovers, or batch handling may require review.

Codes:

- FOOD_SAFETY_TEMP_REQUIRED.
- FOOD_SAFETY_RAW_OR_UNDERCOOKED_ATTENTION.
- FOOD_SAFETY_UNPASTEURIZED_ATTENTION.
- FOOD_SAFETY_SEAFOOD_ATTENTION.
- FOOD_SAFETY_RAW_SPROUT_ATTENTION.
- FOOD_SAFETY_LEFTOVER_STORAGE_ATTENTION.
- FOOD_SAFETY_COOLING_REHEATING_ATTENTION.
- FOOD_SAFETY_CROSS_CONTAMINATION_ATTENTION.
- FOOD_SAFETY_BATCH_STORAGE_ATTENTION.
- FOOD_SAFETY_HIGH_RISK_INGREDIENT.

Class-specific fields:

- Food safety issue.
- Source ingredient or process step.
- Temperature requirement when available.
- Storage requirement when available.
- Reheating requirement when available.
- Batch handling note.
- Review lane.

The Master Library records food safety requirements.

The household care profile decides immune-risk relevance.

## Texture, Chewing, and Swallowing Flags

Use recipe-texture flags based on the food itself.

Texture can be positive, neutral, or review-worthy depending on the person.

Codes:

- TEXTURE_SOFT_COMPONENT.
- TEXTURE_TENDER_COMPONENT.
- TEXTURE_MOIST_COMPONENT.
- TEXTURE_CRUNCHY_COMPONENT.
- TEXTURE_CRISP_COMPONENT.
- TEXTURE_DRY_RISK.
- TEXTURE_STICKY_RISK.
- TEXTURE_CRUMBLY_RISK.
- TEXTURE_STRINGY_RISK.
- TEXTURE_MIXED_TEXTURE.
- TEXTURE_SMALL_PIECES_READY.
- TEXTURE_SAUCE_ADDITION_READY.
- TEXTURE_SWALLOWING_REVIEW_CANDIDATE.
- TEXTURE_CHEWING_REVIEW_CANDIDATE.

Class-specific fields:

- Texture type.
- Source ingredient or component.
- Positive texture use.
- Review candidate reason.
- Adaptation option.
- Serving form.

Crunch can support appetite and satisfaction for one person.

Crunch can require review for another person.

The Master Library records texture behavior.

The household care profile decides preferred texture, unsafe texture, appetite texture, chewing adaptation, or swallowing adaptation.

## Appetite, Sensory, and Taste Flags

Use when aroma, temperature, color, bitterness, spice, serving size, visual load, metallic taste candidates, smell sensitivity, or appetite burden may matter.

Codes:

- APPETITE_SUPPORT_CANDIDATE.
- SMALL_PORTION_READY.
- LARGE_PORTION_VISUAL_LOAD.
- AROMA_FORWARD.
- LOW_AROMA_MEAL.
- COLOR_CONTRAST_PRESENT.
- BITTERNESS_ATTENTION.
- METALLIC_TASTE_CANDIDATE.
- STRONG_AROMATIC_ATTENTION.
- SPICE_HEAT_ATTENTION.
- ACID_FORWARD_COMPONENT.
- SWEET_FORWARD_COMPONENT.
- UMAMI_FORWARD_COMPONENT.
- TEMPERATURE_SENSITIVE_SERVING.
- SENSORY_REVIEW_CANDIDATE.

Class-specific fields:

- Sensory factor.
- Source ingredient or recipe feature.
- Appetite use.
- Burden candidate.
- Serving suggestion.
- Downstream appetite module candidate.

The Master Library records sensory behavior.

The household care profile decides preference, aversion, symptom relevance, and current appetite mode.

## Flavor Strategy Tags

Use flavor tags as recipe craft metadata.

Flavor tags are recipe technique facts.

Clinical meaning belongs to downstream interpretation.

Codes:

- FLAVOR_BROWNING.
- FLAVOR_SEARING.
- FLAVOR_TOASTING.
- FLAVOR_ACID_BALANCE.
- FLAVOR_FRESH_HERBS.
- FLAVOR_DRY_SPICES.
- FLAVOR_AROMATICS.
- FLAVOR_UMAMI_SOURCE.
- FLAVOR_TEXTURE_CONTRAST.
- FLAVOR_FINISHING_OIL.
- FLAVOR_SAUCE_BASED.
- FLAVOR_COMFORT_CUE.
- FLAVOR_LOW_SODIUM_STRATEGY.
- FLAVOR_LOW_SUGAR_STRATEGY.
- FLAVOR_LOW_FAT_STRATEGY.
- FLAVOR_MILD_PROFILE.
- FLAVOR_BOLD_PROFILE.
- FLAVOR_BRIGHT_PROFILE.
- FLAVOR_SAVORY_PROFILE.
- FLAVOR_SWEET_FORWARD_PROFILE.
- FLAVOR_SPICE_HEAT_PROFILE.

Class-specific fields:

- Flavor method.
- Source ingredient or process step.
- Role in recipe.
- Household preference candidate.
- Appetite mode candidate.

The Master Library records how flavor is built.

The household care profile decides which methods fit the person that day.

## Allergen and Restriction Flags

Use for common allergens, cultural review, religious review, personal exclusions, and household restrictions.

Codes:

- ALLERGEN_DAIRY.
- ALLERGEN_EGG.
- ALLERGEN_FISH.
- ALLERGEN_SHELLFISH.
- ALLERGEN_TREE_NUT.
- ALLERGEN_PEANUT.
- ALLERGEN_WHEAT.
- ALLERGEN_SOY.
- ALLERGEN_SESAME.
- ALLERGEN_SULFITE_ATTENTION.
- RELIGIOUS_REVIEW_CANDIDATE.
- CULTURAL_REVIEW_CANDIDATE.
- PERSONAL_EXCLUSION_REVIEW_CANDIDATE.
- HOUSEHOLD_RULE_REVIEW_CANDIDATE.

Class-specific fields:

- Allergen or restriction class.
- Source ingredient.
- Hidden source candidate.
- Substitution candidate.
- Review lane.

The Master Library records the ingredient class.

The household care profile decides permission, substitution, block, or caregiver note.

## Caregiver Execution Flags

Use when the recipe may affect time, steps, tools, cleanup, shopping, batch cooking, leftovers, storage, fatigue, or rescue-meal use.

Codes:

- CAREGIVER_STEP_HEAVY.
- CAREGIVER_TOOL_HEAVY.
- CAREGIVER_CLEANUP_HEAVY.
- CAREGIVER_SHOPPING_SPECIALTY_ITEM.
- CAREGIVER_ACTIVE_COOKING_HEAVY.
- CAREGIVER_PASSIVE_COOKING_FRIENDLY.
- CAREGIVER_BATCH_FRIENDLY.
- CAREGIVER_FREEZER_FRIENDLY.
- CAREGIVER_LEFTOVER_FRIENDLY.
- CAREGIVER_FAST_RESCUE_READY.
- CAREGIVER_ONE_PAN_READY.
- CAREGIVER_NO_COOK_READY.
- CAREGIVER_PREP_AHEAD_READY.

Class-specific fields:

- Execution factor.
- Recipe step or ingredient source.
- Time impact.
- Tool impact.
- Cleanup impact.
- Shopping impact.
- Batch impact.
- Rescue-meal potential.

The Master Library records execution burden.

The household care profile decides fit against caregiver capacity.

## Cultural and Household Fit Flags

Use when cultural origin, religious needs, food identity, comfort food pattern, family recipe pattern, or household acceptance may matter downstream.

Codes:

- CULTURAL_ORIGIN_PRESENT.
- CULTURAL_ADAPTATION_REVIEW_CANDIDATE.
- RELIGIOUS_PATTERN_REVIEW_CANDIDATE.
- FAMILY_RECIPE_ADAPTATION_READY.
- COMFORT_FOOD_PATTERN_PRESENT.
- FAMILIARITY_SUPPORT_CANDIDATE.
- HOUSEHOLD_ACCEPTANCE_REVIEW_CANDIDATE.

Class-specific fields:

- Cultural or household factor.
- Source ingredient or recipe feature.
- Adaptation candidate.
- Review lane.

The Master Library records cultural and household fit metadata.

The household care profile decides fit, substitution, permission, and preferred version.

## Clinical Review Routing Flags

Use these flags to route internal review.

Codes:

- REVIEW_NUTRITION_DATA.
- REVIEW_MINERALS_ELECTROLYTES.
- REVIEW_VITAMINS_MICRONUTRIENTS.
- REVIEW_MACRONUTRIENTS.
- REVIEW_FLUID_HYDRATION.
- REVIEW_MEDICATION_SUPPLEMENT.
- REVIEW_FOOD_SAFETY.
- REVIEW_TEXTURE_SWALLOWING.
- REVIEW_APPETITE_SENSORY.
- REVIEW_ALLERGEN_RESTRICTION.
- REVIEW_CAREGIVER_EXECUTION.
- REVIEW_CULTURAL_HOUSEHOLD_FIT.
- REVIEW_SUBSTITUTION_LOGIC.
- REVIEW_HOUSEHOLD_ADAPTATION_READY.

Class-specific fields:

- Review lane.
- Triggering flag codes.
- Reviewer type candidate.
- Release impact.
- Caveat candidate.
- Audit note.

Clinical Review output may include caveats, approvals, denials, audit notes, and release status.

Master Library output keeps review language internal and structured.

## Flag Output Rules

Return triggered flags only.

Use recipe facts, ingredient facts, nutrition lookup, portion size, preparation method, and confidence level.

Use neutral language.

Use review candidate language.

Use measured values when verified.

Use estimated values when verification remains pending.

Use portion basis every time.

Use downstream module candidate every time.

Use class-specific fields when applicable.

Use ingredient class and nutrient class language for medication and supplement candidates.

Use recipe-texture language for texture flags.

Use recipe-craft language for flavor tags.

Use recipe-execution language for caregiver flags.

Reserve person-level interpretation for the household care profile.

Reserve disease-specific interpretation for active household modules.

Reserve medication-specific interpretation for active medication modules.

Reserve daily totals for the household care profile.

Reserve provider-order logic for the household care profile.

Reserve caregiver-facing clinical advice for approved downstream output.

## Recipe Language Rules

Use plain caregiver language.

Use food-first language.

Use short practical steps.

Use measured ingredients.

Use clear serving sizes.

Use internal review labels only in the Clinical Review packet.

Use person-neutral recipe copy in the Master Library.

Use “review candidate” for flags.

Use “verified,” “estimated,” or “pending” for nutrition values.

Use “portion dependent” when amount changes the flag impact.

Use “substitution ready” when a swap path exists.

Use “household adaptation ready” when the Master Library recipe carries enough data for downstream personalization.

## Master Library Release Rules

A recipe may release to the Master Library when:

- Ingredient list is normalized.
- Serving size is clear.
- Execution steps are clear.
- Food safety steps are present when needed.
- Nutrition data status is present.
- Triggered flags are structured.
- Substitution log is present when substitutions occur.
- Clinical Review packet is present.
- Release status is assigned.

A recipe may remain in review when:

- Nutrition lookup remains weak.
- Serving basis needs review.
- Ingredient identity remains unclear.
- Food safety handling needs review.
- Substitution logic needs review.
- Flag packet needs review.
- Clinical reviewer requests caveats.

## QA Stress Test Rule

The complex senior seed profile is a pressure test.

It proves the Master Library can support:

- Hard mineral and electrolyte targets.
- Medication timing.
- Hydration planning.
- Food safety.
- Immune-risk thinking.
- Texture changes.
- Appetite changes.
- Taste changes.
- Caregiver fatigue.
- Household execution.
- Batch planning.
- Clinical review.

The complex senior seed profile drives test coverage.

The Master Library record stays reusable.

The household care profile applies the person-specific rules.

## Final Output Contract

Every Super Admin Master Library recipe generation should return:

- Recipe Identity.
- Recipe Summary.
- Ingredient Loadout.
- Execution Steps.
- What Done Looks Like.
- Nutrition Snapshot.
- Substitution Log.
- Texture Tags.
- Flavor Strategy Tags.
- Caregiver Execution Notes.
- Pairing Candidates.
- Variation Candidates.
- Flag Packet.
- Clinical Review Packet.
- Review Status.
- Audit Notes.

Every flag should return:

- Flag code.
- Flag class.
- Trigger.
- Ingredient or component.
- Value.
- Unit.
- Portion basis.
- Confidence.
- Review lane.
- Downstream module candidate.
- Class-specific fields when applicable.

The Master Library produces generally healthy, senior-compatible, clinically review-ready recipe records. Final person-level clinical fit is determined downstream by the household care profile, active modules, nutrition verification, and Clinical Review.

The Master Library creates the reusable recipe record.

The flag packet carries the care intelligence.

The household care profile makes it personal.

The Clinical Review workflow controls approval and release.


## Output Separation Rule

The Master Library Recipe Profile creates the complete internal recipe record.

The full Master Library record is not the caregiver-facing output.

The caregiver-facing output must be generated as a separate compact recipe card after Master Library generation, nutrition lookup, flagging, household adaptation, and Clinical Review.

By default, never show the full Flag Packet, Clinical Review Packet, audit notes, model trace, nutrition confidence detail, downstream module candidates, or review routing language to caregivers.

Caregiver-facing output should show only:

- Recipe title.
- Short meal summary.
- Time.
- Servings.
- Difficulty.
- Ingredients.
- Steps.
- What done looks like.
- Simple substitutions.
- Household-safe care notes.
- Approval status.

Clinical and flag details may appear behind a “Details,” “Why this fits,” or “Clinical Review” panel based on user role and permissions.

Super Admin sees the full record.

Care Team sees the clinical packet.

Household Owner may see simplified fit notes.

Caregiver sees the cooking card.

Viewer sees the released recipe only.
