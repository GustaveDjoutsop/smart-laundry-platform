-- Seed default maintenance thresholds
INSERT INTO ops.settings (key, value) VALUES
  ('maintenance_thresholds', '{"warning": 300, "critical": 400}'::jsonb)
ON CONFLICT (key) DO NOTHING;
