CREATE TABLE pharmacy_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description VARCHAR(500),
    price DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'XAF',
    stock INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(100),
    requires_prescription BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pharmacy_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES pharmacy_products(id),
    customer_phone VARCHAR(20) NOT NULL,
    quantity INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pharmacy_products_name ON pharmacy_products(name);
CREATE INDEX idx_pharmacy_products_category ON pharmacy_products(category);
CREATE INDEX idx_pharmacy_products_active ON pharmacy_products(active, stock);
CREATE INDEX idx_pharmacy_reservations_phone ON pharmacy_reservations(customer_phone, status);
CREATE INDEX idx_pharmacy_reservations_product ON pharmacy_reservations(product_id, status);
