-- Production Care Team roster.
--
-- Retires the 6 prototype personas seeded in migration 003 and installs the
-- production committee from business/Chairwoman & Care Team: 8 specialists +
-- the ChairwomanAI synthesizer. Persona prompt text is the bundled default in
-- prompts.js (keyed by role_key); system_prompt stays null here so the Super
-- Admin can override per-row later without a deploy.
--
-- provider/model are operator-tunable. We map across the three adapters the
-- backend currently ships (anthropic, groq, gemini); the architecture plan's
-- intended providers (Deepseek/OpenAI/Perplexity/PaLM) become available when
-- those adapters are added — just update the row.

-- Remove the prototype seed (6 specialists + old chairman) so we don't run a
-- doubled-up committee. recipe_brain_runs store provider/model/role_key as text,
-- so no run history is broken by this.
delete from llm_provider_configs
where role_key in (
  'dietician', 'clinical_nutritionist', 'chef',
  'cardiologist', 'nephrologist', 'neurologist',
  'chairman'
);

insert into llm_provider_configs (role_key, display_name, kind, provider, model, position)
values
  ('nephrology',         'NephAI',         'specialist', 'groq',      'llama-3.3-70b-versatile', 10),  -- plan: Llama
  ('cardiology',         'CardAI',         'specialist', 'anthropic', 'claude-sonnet-4-6',       20),  -- plan: Deepseek
  ('primary_care',       'PCPAI',          'specialist', 'anthropic', 'claude-sonnet-4-6',       30),  -- plan: OpenAI
  ('onc_hema',           'Onc/HemaAI',     'specialist', 'anthropic', 'claude-sonnet-4-6',       40),  -- plan: Claude
  ('neurology',          'NeuroAI',        'specialist', 'gemini',    'gemini-2.0-flash',        50),  -- plan: Gemini
  ('orthopedics',        'OrthoAI',        'specialist', 'groq',      'llama-3.3-70b-versatile', 60),  -- plan: Groq
  ('clinical_nutrition', 'NutrAI',         'specialist', 'gemini',    'gemini-2.0-flash',        70),  -- plan: Perplexity
  ('culinary',           'StarChefAI',     'specialist', 'groq',      'llama-3.3-70b-versatile', 80),  -- plan: PaLM / chef
  ('chairman',           'ChairwomanAI',   'chairman',   'anthropic', 'claude-sonnet-4-6',        0)   -- synthesis
on conflict (role_key) do update set
  display_name = excluded.display_name,
  kind = excluded.kind,
  provider = excluded.provider,
  model = excluded.model,
  position = excluded.position,
  active = true;
