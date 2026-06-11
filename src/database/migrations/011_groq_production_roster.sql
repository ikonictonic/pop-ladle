-- Production roster runs Groq-only (user decision): every committee member —
-- 8 specialists + ChairwomanAI — moves to the groq provider, each with its own
-- API key resolved from GROQ_API_KEY_<ROLE_KEY> env vars (per-member rate
-- limits), falling back to the shared GROQ_API_KEY.
--
-- The anthropic/gemini adapters stay in code for later use; switching a row
-- back is a Super Admin roster PATCH, no deploy needed.

update llm_provider_configs
set
  provider = 'groq',
  model = 'llama-3.3-70b-versatile',
  updated_at = now()
where provider in ('anthropic', 'gemini');
