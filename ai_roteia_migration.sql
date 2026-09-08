-- Allow the Roteia provider in existing installations.
ALTER TABLE IF EXISTS public.ai_provider_credentials
    DROP CONSTRAINT IF EXISTS ai_provider_credentials_provider_check;
ALTER TABLE IF EXISTS public.ai_provider_credentials
    ADD CONSTRAINT ai_provider_credentials_provider_check
    CHECK (provider IN ('bai','gemini','groq','nvidia','cloudflare','mistral','openrouter','cerebras','custom','roteia'));
