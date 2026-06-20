-- Generic key-value settings store for ops configuration
CREATE TABLE IF NOT EXISTS ops.settings (
    key        TEXT        PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID        REFERENCES ops.staff(id)
);

-- Seed default program pricing so the first GET always returns something
INSERT INTO ops.settings (key, value) VALUES
  ('program_pricing', '[
    {"name": "Express",     "price": 2500},
    {"name": "Standard",    "price": 3000},
    {"name": "Intensif",    "price": 4000},
    {"name": "Dryer - Low", "price": 1500},
    {"name": "Dryer - High","price": 2000}
  ]'::jsonb)
ON CONFLICT (key) DO NOTHING;
