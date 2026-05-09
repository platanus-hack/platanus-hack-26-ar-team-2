-- 0009_realtime_context_chunks.sql — habilita Supabase Realtime postgres_changes
-- en `context_chunks` para que el manager-worker (C-08m) reaccione a INSERTs
-- sin polling.
--
-- Sin esto, supabase-js puede SUBSCRIBE pero nunca recibe payloads de INSERT.
-- Verificación post-apply:
--   select tablename from pg_publication_tables where pubname='supabase_realtime';
-- → debe incluir 'context_chunks'.

alter publication supabase_realtime add table context_chunks;
