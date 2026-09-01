-- ============================================================================
-- Relationship Hub — upgrade: opportunity tags on households.
-- Run on a database already on 0001–0006. Idempotent and single-step.
--
-- Adds clients.tags so you can flag a household with things like a Roth
-- conversion, a side fund, long-term care, or money due — then search and
-- filter the book by them. Tags are plain text; the app owns the list, so
-- adding a new tag later is an app change only, no migration.
-- ============================================================================

alter table clients add column if not exists tags text[] not null default '{}';

-- Fast "who has this tag?" lookups as the book grows.
create index if not exists clients_tags_idx on clients using gin (tags);

notify pgrst, 'reload schema';
