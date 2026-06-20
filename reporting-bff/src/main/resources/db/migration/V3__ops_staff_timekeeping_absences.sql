-- Staff / employees of the laundromat
CREATE TABLE IF NOT EXISTS ops.staff (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    auth0_id    TEXT        UNIQUE,
    name        TEXT        NOT NULL,
    email       TEXT        NOT NULL UNIQUE,
    role        TEXT        NOT NULL DEFAULT 'employee'
                            CHECK (role IN ('admin','owner','manager','accountant','employee')),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by  UUID        REFERENCES ops.staff(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_email  ON ops.staff (email);
CREATE INDEX IF NOT EXISTS idx_staff_auth0  ON ops.staff (auth0_id) WHERE auth0_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_active ON ops.staff (is_active);

-- Clock-in / clock-out records
CREATE TABLE IF NOT EXISTS ops.time_entries (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id  UUID        NOT NULL REFERENCES ops.staff(id),
    type         TEXT        NOT NULL CHECK (type IN ('clock_in','clock_out')),
    timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method       TEXT        NOT NULL DEFAULT 'manual'
                             CHECK (method IN ('manual','automatic','system')),
    notes        TEXT,
    created_by   UUID        REFERENCES ops.staff(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON ops.time_entries (employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_ts       ON ops.time_entries (timestamp DESC);

-- Vacation / sick / personal leave records
CREATE TABLE IF NOT EXISTS ops.absences (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id   UUID        NOT NULL REFERENCES ops.staff(id),
    type          TEXT        NOT NULL
                              CHECK (type IN ('vacation','sick','personal',
                                             'unpaid_leave','family_emergency','training')),
    start_date    DATE        NOT NULL,
    end_date      DATE        NOT NULL,
    reason        TEXT,
    status        TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected')),
    reviewed_by   UUID        REFERENCES ops.staff(id),
    reviewed_at   TIMESTAMPTZ,
    review_notes  TEXT,
    created_by    UUID        REFERENCES ops.staff(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_absence_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_absences_employee ON ops.absences (employee_id);
CREATE INDEX IF NOT EXISTS idx_absences_status   ON ops.absences (status);
CREATE INDEX IF NOT EXISTS idx_absences_dates    ON ops.absences (start_date);
