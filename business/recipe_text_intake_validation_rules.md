# Recipe Text Intake Validation Rules

## Core Rule

The user must enter a real recipe before the recipe can be submitted.

A real recipe must contain enough structure for the system to understand what is being cooked, what ingredients are used, how it is prepared, and what the finished food should look like.

The system must block vague prompts, recipe ideas, food wishes, or single-sentence requests.

The Care Team must never receive input like:

- “Make me a cake.”
- “Make a chicken dinner.”
- “Give me a low sodium recipe.”
- “I want something soft.”
- “Create a dessert.”

Those are not recipes. They are recipe requests.

## Required Fields for a Valid Recipe

The front end must check for the following minimum recipe structure:

1. Recipe title
2. Recipe description or summary
3. Ingredients list
4. Cooking or preparation instructions
5. Serving amount
6. What done looks like, or a clear doneness cue

## Minimum Acceptance Rules

A recipe may be accepted only if all of these are true:

1. The recipe has a title.
2. The recipe has at least 3 ingredients.
3. The ingredients include recognizable food items.
4. At least 2 ingredients include a quantity, unit, or portion cue.
5. The recipe has at least 3 preparation or cooking steps.
6. The instructions include cooking, mixing, chilling, baking, blending, simmering, sautéing, assembling, reheating, or serving actions.
7. The recipe includes servings, yield, or portion count.
8. The recipe includes either a doneness cue or enough cooking detail to infer completion.
9. The text is long enough to plausibly be a recipe, not a prompt.
10. The input is not just a request for the system to create something.

## Examples of Valid Recipe Input

```text
Title: Lemon Yogurt Cake

Description: A soft lemon cake made with yogurt, lemon zest, eggs, flour, and a light glaze.

Servings: 8

Ingredients:
- 1 cup plain Greek yogurt
- 2 eggs
- 1/2 cup sugar
- 1/3 cup olive oil
- 1 1/2 cups flour
- 2 teaspoons baking powder
- 1 tablespoon lemon zest
- 2 tablespoons lemon juice

Instructions:
1. Preheat oven to 350°F.
2. Whisk yogurt, eggs, sugar, oil, lemon zest, and lemon juice.
3. Stir in flour and baking powder.
4. Pour into a greased loaf pan.
5. Bake for 35 to 45 minutes.

What done looks like:
The cake is golden, firm in the center, and a toothpick comes out clean.
```

## Examples of Invalid Input

Block inputs like:

- Make me a cake.
- Make a lemon dessert.
- Create a healthy chicken recipe.
- Give me a soft dinner.
- I want soup.
- Make this low sodium.
- Can you make something with rice?
- Need a recipe for breakfast.

These inputs do not include a complete recipe.

## Front-End Validation Requirements

The front end must run recipe text validation before allowing submission.

The submit button should stay disabled or return an error until the recipe contains:

- Title
- Description or summary
- Ingredients
- Instructions
- Servings
- Doneness cue or completion cue

The front end should not call the Care Team.

The front end should not show the Care Team loading state.

The front end should not start model routing.

The front end should not create a recipe generation run.

The front end should first validate that the user entered a real recipe.

## Recommended Missing Field Messages

### If title is missing

```text
Please add the recipe title.
```

### If description is missing

```text
Please add a short description of the recipe.
```

### If ingredients are missing

```text
Please add the ingredients, including amounts where possible.
```

### If ingredients are too weak

```text
Please add a complete ingredient list with at least 3 ingredients.
```

### If instructions are missing

```text
Please add the cooking or preparation steps.
```

### If instructions are too weak

```text
Please add enough steps to explain how the recipe is made.
```

### If servings are missing

```text
Please add the number of servings or the recipe yield.
```

### If doneness cue is missing

```text
Please add what done looks like, such as golden brown, tender, thickened, chilled, or cooked through.
```

### If the user entered only a prompt

```text
This looks like a recipe request, not a recipe. Please paste the full recipe with title, ingredients, instructions, servings, and what done looks like.
```

## User Correction Message

When the recipe is blocked, show this message:

```text
Please enter the full recipe before submitting. I need the title, description, ingredients, instructions, servings, and what done looks like so the Care Team has enough information to review and adapt it safely.
```

Helper actions:

- Paste Full Recipe
- Use Recipe Template
- Upload Recipe Image
- Enter Recipe URL

## Recipe Template to Show the User

```markdown
# Recipe Title

## Description

## Servings

## Ingredients

- 
- 
- 

## Instructions

1.
2.
3.

## What Done Looks Like

## Notes, if any
```

## Backend Validation Rule

The backend must repeat the same validation.

Do not rely only on the front end.

The backend must reject any recipe submission that does not contain a valid structured recipe.

The backend must return:

- `allowed`
- `reason`
- `missingFields`
- `message`
- `careTeamDispatchAllowed`

## Backend Response for Invalid Recipe Input

```json
{
  "allowed": false,
  "reason": "NOT_A_VALID_RECIPE",
  "missingFields": ["ingredients", "instructions", "servings", "what done looks like"],
  "message": "Please enter a complete recipe with title, description, ingredients, instructions, servings, and what done looks like before submitting.",
  "careTeamDispatchAllowed": false
}
```

## Backend Response for Valid Recipe Input

```json
{
  "allowed": true,
  "reason": "VALID_RECIPE_STRUCTURE",
  "missingFields": [],
  "message": "Recipe structure is complete.",
  "careTeamDispatchAllowed": true
}
```

## Required Structured Recipe Object

The recipe should be converted into this structure before it can move forward:

```json
{
  "title": "",
  "description": "",
  "servings": "",
  "ingredients": [],
  "instructions": [],
  "whatDoneLooksLike": "",
  "notes": ""
}
```

## Care Team Dispatch Rule

The Care Team can only be called when all of these are true:

- `recipeStructureValid` is `true`
- `careTeamDispatchAllowed` is `true`
- `title` exists
- `ingredients` exist
- `instructions` exist
- `servings` exists
- `whatDoneLooksLike` exists

If any of those are false or missing, stop the workflow.

## Product Rule

The recipe entry field is for entering a full recipe.

It is not a prompt box.

It is not a recipe idea box.

It is not a “make me something” box.

The system must force the user to provide a complete recipe before the Care Team is called.
