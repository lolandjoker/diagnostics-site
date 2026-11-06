-- Поиск по тексту сообщений (lib/staff-inbox.ts, searchMessages): trigram-индекс ускоряет ILIKE '%…%'.
-- Нет расширения pg_trgm (PGlite в тестах) — без индекса, поиск всё равно работает.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS messages_body_trgm_idx ON messages USING gin (body gin_trgm_ops);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_trgm недоступен — поиск по сообщениям без индекса';
END $$;
