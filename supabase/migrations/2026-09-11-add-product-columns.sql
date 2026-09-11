-- Migration: Add missing product columns
-- Run in Supabase Dashboard → SQL Editor
-- Date: 2026-09-11

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'unit_type'
    ) THEN
        ALTER TABLE products ADD COLUMN unit_type TEXT DEFAULT NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'unit_value'
    ) THEN
        ALTER TABLE products ADD COLUMN unit_value NUMERIC DEFAULT NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'is_related_enabled'
    ) THEN
        ALTER TABLE products ADD COLUMN is_related_enabled BOOLEAN DEFAULT TRUE;
    END IF;
END $$;
