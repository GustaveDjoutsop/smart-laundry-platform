-- Dedicated dryer cycle prices, mirroring short_cycle/long_cycle for washers.
-- Lets the bot's "Start a Dry" flow charge dryers independently of wash pricing.
INSERT INTO payment.pricing (key, amount, currency, label) VALUES
    ('dry_short', 1000, 'XAF', 'Express Dry (30 min)'),
    ('dry_long',  2000, 'XAF', 'Standard Dry (60 min)')
ON CONFLICT (key) DO NOTHING;
