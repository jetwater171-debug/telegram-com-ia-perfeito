-- Migration: Add ai_debug column to messages table for Advanced Prompt & Response Inspector
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_debug JSONB;
