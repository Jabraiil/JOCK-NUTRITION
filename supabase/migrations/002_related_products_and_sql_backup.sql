-- ============================================
-- JACK NUTRITION - Migration 002
-- Явные связанные товары + поддержка SQL-дампа
-- ============================================

-- ============================================
-- product_related (явные связи между товарами)
-- ============================================
CREATE TABLE IF NOT EXISTS product_related (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    related_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, related_id)
);

-- Индекс для быстрого получения связей товара
CREATE INDEX IF NOT EXISTS idx_product_related_product_id ON product_related(product_id);

-- RLS: публичное чтение связей
ALTER TABLE product_related ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read product_related" ON product_related
    FOR SELECT USING (true);

-- RLS: запись только через service_role (Edge Function)
CREATE POLICY "Admin write product_related" ON product_related
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- SQL-дамп (функция генерирует .sql вместо JSON)
-- ============================================
-- Возвращает текстовый SQL-дамп всех таблиц магазина в формате COPY.
-- Используется Edge Function admin-api /backup-sql.
CREATE OR REPLACE FUNCTION generate_sql_dump()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    dump TEXT := '';
    tbl RECORD;
    col RECORD;
    row_rec RECORD;
    col_names TEXT := '';
    col_vals TEXT := '';
    first_col BOOLEAN;
    is_null BOOLEAN;
    escaped TEXT;
BEGIN
    dump := dump || '-- JACK NUTRITION SQL dump' || E'\n';
    dump := dump || '-- Generated: ' || NOW() || E'\n';
    dump := dump || '-- DO NOT EDIT MANUALLY' || E'\n\n';

    -- Порядок таблиц (справочники -> товары -> связи -> аналитика)
    FOR tbl IN
        SELECT unnest(ARRAY[
            'categories', 'brands', 'settings', 'products',
            'product_images', 'product_links', 'product_related',
            'orders_analytics', 'order_counter', 'admin_users'
        ]) AS t
    LOOP
        -- Собираем имена колонок
        col_names := '';
        FOR col IN
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl.t
            ORDER BY ordinal_position
        LOOP
            col_names := col_names || CASE WHEN col_names = '' THEN '' ELSE ', ' END
                || quote_ident(col.column_name);
        END LOOP;

        IF col_names = '' THEN
            CONTINUE;
        END IF;

        dump := dump || '-- Table: ' || tbl.t || E'\n';
        dump := dump || 'COPY ' || quote_ident(tbl.t) || ' (' || col_names || ') FROM stdin;\n';

        -- Перебираем строки таблицы
        FOR row_rec IN EXECUTE 'SELECT ' || col_names || ' FROM ' || quote_ident(tbl.t)
        LOOP
            first_col := true;
            col_vals := '';
            FOR col IN
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = tbl.t
                ORDER BY ordinal_position
            LOOP
                EXECUTE 'SELECT $1.' || quote_ident(col.column_name) || ' IS NULL'
                    INTO is_null
                    USING row_rec;

                IF first_col THEN
                    first_col := false;
                ELSE
                    col_vals := col_vals || E'\t';
                END IF;

                IF is_null THEN
                    col_vals := col_vals || '\N';
                ELSE
                    EXECUTE 'SELECT ($1.' || quote_ident(col.column_name) || ')::text'
                        INTO escaped
                        USING row_rec;
                    escaped := replace(escaped, '\', '\\');
                    escaped := replace(escaped, E'\n', '\n');
                    escaped := replace(escaped, E'\t', '\t');
                    escaped := replace(escaped, E'\r', '\r');
                    col_vals := col_vals || escaped;
                END IF;
            END LOOP;
            dump := dump || col_vals || E'\n';
        END LOOP;

        dump := dump || '\.\n\n';
    END LOOP;

    RETURN dump;
END;
$$;
