-- ============================================
-- JACK NUTRITION - Supabase Schema
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Categories
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Brands
-- ============================================
CREATE TABLE IF NOT EXISTS brands (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Products
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    full_description TEXT,
    composition TEXT,
    dosage TEXT,
    usage TEXT,
    contraindications TEXT,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    price INTEGER NOT NULL,
    old_price INTEGER,
    stock INTEGER DEFAULT 0,
    volume TEXT,
    sku TEXT UNIQUE,
    barcode TEXT,
    is_hit BOOLEAN DEFAULT FALSE,
    is_new BOOLEAN DEFAULT FALSE,
    is_discount BOOLEAN DEFAULT FALSE,
    shelf_life TEXT,
    is_visible BOOLEAN DEFAULT TRUE,
    is_related_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product images (up to 4)
CREATE TABLE IF NOT EXISTS product_images (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    is_main BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product links (up to 4)
CREATE TABLE IF NOT EXISTS product_links (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Settings
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES
    ('whatsapp_number', ''),
    ('store_name', 'JACK NUTRITION'),
    ('logo_text', 'JACK NUTRITION'),
    ('currency', '₽'),
    ('order_error_code', '[!CHECK!]'),
    ('timezone', 'Europe/Moscow'),
    ('order_time_limit_enabled', 'true'),
    ('order_start_hour', '9'),
    ('order_end_hour', '20')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- Orders Analytics (anonymized)
-- ============================================
CREATE TABLE IF NOT EXISTS orders_analytics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_number TEXT NOT NULL,
    items JSONB NOT NULL,
    total INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_orders_analytics_created_at ON orders_analytics(created_at);

-- ============================================
-- Order Counter
-- ============================================
CREATE TABLE IF NOT EXISTS order_counter (
    id INTEGER PRIMARY KEY DEFAULT 1,
    counter INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO order_counter (id, counter) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Admin Users
-- ============================================
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Enable RLS
-- ============================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies (public read for shop)
-- ============================================

-- Categories: public read
CREATE POLICY "Public read categories" ON categories
    FOR SELECT USING (true);

-- Brands: public read
CREATE POLICY "Public read brands" ON brands
    FOR SELECT USING (true);

-- Products: public read visible only
CREATE POLICY "Public read visible products" ON products
    FOR SELECT USING (is_visible = true);

-- Product images: public read
CREATE POLICY "Public read product_images" ON product_images
    FOR SELECT USING (true);

-- Product links: public read
CREATE POLICY "Public read product_links" ON product_links
    FOR SELECT USING (true);

-- Settings: public read
CREATE POLICY "Public read settings" ON settings
    FOR SELECT USING (true);

-- Orders analytics: no public access (only Edge Functions)
CREATE POLICY "No public access orders_analytics" ON orders_analytics
    FOR ALL USING (false);

-- Order counter: no public access
CREATE POLICY "No public access order_counter" ON order_counter
    FOR ALL USING (false);

-- Admin users: no public access
CREATE POLICY "No public access admin_users" ON admin_users
    FOR ALL USING (false);

-- ============================================
-- Storage buckets
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Public read product images" ON storage.objects
    FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated upload product images" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'product-images' AND
        auth.role() = 'authenticated'
    );

CREATE POLICY "Authenticated update product images" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'product-images' AND
        auth.role() = 'authenticated'
    );

CREATE POLICY "Authenticated delete product images" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'product-images' AND
        auth.role() = 'authenticated'
    );

-- ============================================
-- Functions for upsert
-- ============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON brands
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_order_counter_updated_at BEFORE UPDATE ON order_counter
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Admin-only policies (using service_role)
-- ============================================

-- Categories: admin write
CREATE POLICY "Admin write categories" ON categories
    FOR ALL USING (auth.role() = 'service_role');

-- Brands: admin write
CREATE POLICY "Admin write brands" ON brands
    FOR ALL USING (auth.role() = 'service_role');

-- Products: admin write
CREATE POLICY "Admin write products" ON products
    FOR ALL USING (auth.role() = 'service_role');

-- Product images: admin write
CREATE POLICY "Admin write product_images" ON product_images
    FOR ALL USING (auth.role() = 'service_role');

-- Product links: admin write
CREATE POLICY "Admin write product_links" ON product_links
    FOR ALL USING (auth.role() = 'service_role');

-- Settings: admin write
CREATE POLICY "Admin write settings" ON settings
    FOR ALL USING (auth.role() = 'service_role');

-- Orders analytics: admin read
CREATE POLICY "Admin read orders_analytics" ON orders_analytics
    FOR SELECT USING (auth.role() = 'service_role');

-- Order counter: admin write
CREATE POLICY "Admin write order_counter" ON order_counter
    FOR ALL USING (auth.role() = 'service_role');

-- Admin users: admin read/write
CREATE POLICY "Admin read admin_users" ON admin_users
    FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "Admin write admin_users" ON admin_users
    FOR ALL USING (auth.role() = 'service_role');
