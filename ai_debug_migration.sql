-- Migration: Add ai_debug column to messages table for Advanced Prompt & Response Inspector
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_debug JSONB;
COMMENT ON COLUMN messages.ai_debug IS 'Per-turn AI request, pipeline telemetry, raw draft and final normalized response for the authenticated admin inspector.';
