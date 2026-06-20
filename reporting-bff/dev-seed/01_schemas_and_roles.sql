-- Local dev seed: mirrors Supabase schema layout for BFF development.
-- Runs automatically on first docker-compose.dev.yml up.

CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS machine;
CREATE SCHEMA IF NOT EXISTS bot;
CREATE SCHEMA IF NOT EXISTS ops;

CREATE ROLE reporting_svc WITH LOGIN PASSWORD 'devpassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA payment, machine, bot TO reporting_svc;
GRANT CREATE, USAGE ON SCHEMA ops TO reporting_svc;

-- machine.machines (mirrors MachineStateService Machine entity)
CREATE TABLE machine.machines (
    id              BIGSERIAL PRIMARY KEY,
    machine_id      VARCHAR(30) UNIQUE NOT NULL,
    type            VARCHAR(10)  NOT NULL DEFAULT 'WASHER',
    brand           VARCHAR(50)  NOT NULL DEFAULT 'LG',
    model           VARCHAR(50)  NOT NULL DEFAULT 'Commercial Pro',
    status          VARCHAR(20)  NOT NULL DEFAULT 'IDLE',
    comm_protocol   VARCHAR(10)  NOT NULL DEFAULT 'MQTT',
    is_online       BOOLEAN      NOT NULL DEFAULT TRUE,
    zone            VARCHAR(30)  NOT NULL DEFAULT 'main',
    position        INT          NOT NULL DEFAULT 1,
    total_cycles    INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
GRANT SELECT ON machine.machines TO reporting_svc;

-- machine.machine_cycles (mirrors MachineStateService MachineCycle entity)
CREATE TABLE machine.machine_cycles (
    id                    BIGSERIAL PRIMARY KEY,
    machine_id            VARCHAR(30) NOT NULL,
    cycle_type            VARCHAR(20) NOT NULL DEFAULT 'WASH',
    status                VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    duration_minutes      INT         NOT NULL DEFAULT 60,
    started_at            TIMESTAMPTZ,
    ends_at               TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    rfid_card_uid         VARCHAR(50),
    transaction_reference VARCHAR(50),
    pulse_count           INT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT ON machine.machine_cycles TO reporting_svc;

-- payment.transactions (mirrors PaymentManagementService Transaction entity)
CREATE TABLE payment.transactions (
    id                  BIGSERIAL PRIMARY KEY,
    external_reference  VARCHAR(50)   UNIQUE NOT NULL,
    amount              NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency            VARCHAR(5)    NOT NULL DEFAULT 'XAF',
    phone_number        VARCHAR(20),
    machine_id          VARCHAR(30),
    pulse_count         INT           NOT NULL DEFAULT 0,
    cycle_duration      INT           NOT NULL DEFAULT 60,
    description         VARCHAR(200),
    status              VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
    payment_provider    VARCHAR(20)   NOT NULL DEFAULT 'MTN_MOMO',
    provider_reference  VARCHAR(100),
    failure_reason      VARCHAR(300),
    rfid_card_uid       VARCHAR(50),
    timeout_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT SELECT ON payment.transactions TO reporting_svc;

-- payment.rfid_cards (mirrors PaymentManagementService RfidCard entity)
CREATE TABLE payment.rfid_cards (
    id           BIGSERIAL PRIMARY KEY,
    card_uid     VARCHAR(50)   UNIQUE NOT NULL,
    owner_name   VARCHAR(100),
    phone_number VARCHAR(20),
    balance      NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency     VARCHAR(5)    NOT NULL DEFAULT 'XAF',
    is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT SELECT ON payment.rfid_cards TO reporting_svc;

-- reporting_svc owns ops schema — Flyway V1+V2 will create tables there
ALTER SCHEMA ops OWNER TO reporting_svc;

-- Seed minimal test data
INSERT INTO machine.machines (machine_id, type, status, zone) VALUES
  ('W01', 'WASHER', 'RUNNING', 'Zone A'),
  ('W02', 'WASHER', 'IDLE',    'Zone A'),
  ('D01', 'DRYER',  'IDLE',    'Zone B');

INSERT INTO payment.transactions (external_reference, amount, currency, phone_number, machine_id, cycle_duration, status, payment_provider, created_at) VALUES
  ('TXN-001', 2500, 'XAF', '237670000001', 'W01', 60, 'SUCCESSFUL', 'MTN_MOMO',     NOW() - INTERVAL '2 hours'),
  ('TXN-002', 2500, 'XAF', '237670000002', 'W02', 60, 'SUCCESSFUL', 'MTN_MOMO',     NOW() - INTERVAL '1 hour'),
  ('TXN-003', 1500, 'XAF', '237690000003', 'D01', 40, 'PENDING',    'ORANGE_MONEY', NOW() - INTERVAL '10 minutes');

INSERT INTO machine.machine_cycles (machine_id, cycle_type, status, duration_minutes, started_at, ends_at, completed_at, transaction_reference) VALUES
  ('W02', 'WASH', 'COMPLETED', 60, NOW() - INTERVAL '90 minutes', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes', 'TXN-002'),
  ('W01', 'WASH', 'RUNNING',   60, NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '30 minutes', NULL, 'TXN-001');

-- ops.feedback is created by Flyway V2 on BFF startup.
-- Seed a few rows here so dev smoke-tests have data.
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
-- Transfer ownership so Flyway V2 (runs as reporting_svc) can create indexes
ALTER TABLE ops.feedback OWNER TO reporting_svc;

CREATE INDEX IF NOT EXISTS idx_feedback_machine   ON ops.feedback (machine_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating    ON ops.feedback (rating);
CREATE INDEX IF NOT EXISTS idx_feedback_submitted ON ops.feedback (submitted_at DESC);

INSERT INTO ops.feedback (transaction_reference, machine_id, phone_number, rating, comment, submitted_at, amount, cycle_duration) VALUES
  ('TXN-002', 'W02', '237670000002', 5, NULL,                          NOW() - INTERVAL '25 minutes', 2500, 60),
  ('TXN-001', 'W01', '237670000001', 3, 'Machine was a bit noisy.',    NOW() - INTERVAL '5 hours',   2500, 60);
