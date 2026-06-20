CREATE TABLE IF NOT EXISTS ops.expenses (
    id             BIGSERIAL       PRIMARY KEY,
    category       VARCHAR(50)     NOT NULL,
    description    VARCHAR(500)    NOT NULL,
    amount         NUMERIC(12, 2)  NOT NULL,
    currency       CHAR(3)         NOT NULL DEFAULT 'XAF',
    expense_date   DATE            NOT NULL,
    payment_method VARCHAR(50),
    vendor         VARCHAR(200),
    receipt_number VARCHAR(100),
    notes          TEXT,
    is_recurring   BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date     ON ops.expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON ops.expenses (category);

CREATE TABLE IF NOT EXISTS ops.maintenance_records (
    id                  BIGSERIAL       PRIMARY KEY,
    machine_id          VARCHAR(50)     NOT NULL,
    type                VARCHAR(50)     NOT NULL,
    status              VARCHAR(50)     NOT NULL DEFAULT 'OPEN',
    priority            VARCHAR(20)     NOT NULL DEFAULT 'NORMAL',
    description         TEXT            NOT NULL,
    cost                NUMERIC(12, 2),
    parts_replaced      JSONB,
    is_alert            BOOLEAN         NOT NULL DEFAULT FALSE,
    alert_acknowledged  BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_maintenance_machine ON ops.maintenance_records (machine_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_status  ON ops.maintenance_records (status);
CREATE INDEX IF NOT EXISTS idx_maintenance_alerts  ON ops.maintenance_records (is_alert)
    WHERE is_alert = TRUE AND alert_acknowledged = FALSE;
