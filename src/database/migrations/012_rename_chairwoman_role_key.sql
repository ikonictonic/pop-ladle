-- She is the Chairwoman: rename the synthesizer roster role_key so all
-- user-facing surfaces (admin roster API, per-member env key
-- GROQ_API_KEY_CHAIRWOMAN) use the right name.
--
-- Internal storage discriminators intentionally keep the old spelling
-- (llm_provider_configs.kind = 'chairman', llm_proxy_logs.purpose = 'chairman',
-- table chairman_synthesis_runs) — they are check-constrained encoding, not UI.

update llm_provider_configs
set role_key = 'chairwoman', updated_at = now()
where role_key = 'chairman';
