-- Dynamic pricing table — single source of truth for cycle/reservation prices.
-- Replaces the static values in application.yml and LaundryBotConfig.
CREATE TABLE IF NOT EXISTS payment.pricing (
    key        VARCHAR(50)  PRIMARY KEY,
    amount     INTEGER      NOT NULL CHECK (amount > 0),
    currency   VARCHAR(3)   NOT NULL DEFAULT 'XAF',
    label      VARCHAR(100) NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255)
);

-- Seed from existing static config values.
-- short_cycle / long_cycle match PaymentConfig.Pricing and LaundryBotConfig.
-- reservation_fee = 2000 (= long_cycle price, per ReservationProperties comment:
--   "fee must equal the price of the highest washing cycle").
INSERT INTO payment.pricing (key, amount, currency, label) VALUES
    ('short_cycle',     1000, 'XAF', 'Express Wash (30 min)'),
    ('long_cycle',      2000, 'XAF', 'Standard Wash (60 min)'),
    ('reservation_fee', 2000, 'XAF', 'Reservation Fee')
ON CONFLICT (key) DO NOTHING;
