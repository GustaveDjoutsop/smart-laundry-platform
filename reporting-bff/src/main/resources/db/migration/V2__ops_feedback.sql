CREATE TABLE IF NOT EXISTS ops.feedback (
    id                    BIGSERIAL       PRIMARY KEY,
    transaction_reference VARCHAR(50)     NOT NULL UNIQUE,
    machine_id            VARCHAR(30)     NOT NULL,
    phone_number          VARCHAR(20),
    rating                SMALLINT        NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment               VARCHAR(200),
    submitted_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    staff_alert_sent      BOOLEAN         NOT NULL DEFAULT FALSE,
    amount                NUMERIC(10, 2),
    cycle_duration        INT,
    created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_machine   ON ops.feedback (machine_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating    ON ops.feedback (rating);
CREATE INDEX IF NOT EXISTS idx_feedback_submitted ON ops.feedback (submitted_at DESC);
