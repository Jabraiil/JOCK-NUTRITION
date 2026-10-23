-- Migration: Atomic order counter increment function
-- Prevents race conditions when multiple orders are created in parallel
-- Replaces the unsafe read-modify-write pattern with a single atomic UPDATE

CREATE OR REPLACE FUNCTION increment_order_counter()
RETURNS bigint
LANGUAGE SQL
AS $$
  UPDATE order_counter
  SET counter = counter + 1
  WHERE id = 1
  RETURNING counter;
$$;

-- Ensure the counter row exists (idempotent)
INSERT INTO order_counter (id, counter)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;