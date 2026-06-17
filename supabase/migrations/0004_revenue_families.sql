-- ============================================================================
-- Relationship Hub — upgrade: persisted AUM/revenue + family linking.
-- Run on a database already on 0001/0002/0003. Fully idempotent, single step
-- (a brand-new enum type, unlike ADD VALUE, is usable in the same batch).
-- ============================================================================

do $$ begin
  create type family_role as enum
    ('head', 'spouse', 'partner', 'child', 'grandchild', 'parent', 'sibling', 'other');
exception when duplicate_object then null; end $$;

create table if not exists families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table clients add column if not exists revenue numeric;
alter table clients add column if not exists family_id uuid references families (id) on delete set null;
alter table clients add column if not exists family_role family_role;

create index if not exists clients_family_idx on clients (family_id) where family_id is not null;

drop trigger if exists families_touch on families;
create trigger families_touch before update on families for each row execute function set_updated_at();

alter table families enable row level security;
drop policy if exists "authenticated all families" on families;
create policy "authenticated all families" on families for all to authenticated using (true) with check (true);

-- Base table privileges (RLS still decides which rows are visible).
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Broadcast family changes over realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'families'
     ) then
    alter publication supabase_realtime add table public.families;
  end if;
end $$;

notify pgrst, 'reload schema';
