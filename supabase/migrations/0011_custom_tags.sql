-- ============================================================================
-- Relationship Hub — upgrade: the firm owns its own opportunity tags.
-- Run on a database already on 0001–0010. Idempotent and single-step.
--
-- Opportunity tags used to be a TypeScript union: adding "Roth IRA" meant a
-- code change. They are config, not code, so they move into a table the app
-- can write — same shape as service_models, which the firm already edits.
--
-- Two things make this safe for data that already exists:
--   • the ids are the ones already stored in clients.tags, so every household
--     keeps the tags it has;
--   • clients.tags stays a plain text[] with no foreign key, so a tag can be
--     renamed or removed without touching a single client row.
--
-- keywords are what the dictated-note suggester matches on. Empty is fine and
-- means "never suggest this one, only tick it by hand".
-- ============================================================================

create table if not exists client_tags (
  id         text primary key,
  label      text not null,
  keywords   text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed the ten the firm started with, plus Roth IRA. `on conflict do nothing`
-- means re-running this never overwrites a label or keyword list that has
-- since been edited in the app.
insert into client_tags (id, label, keywords, sort_order) values
  ('roth_conversion', 'Roth Conversion',
   array['roth conversion','convert to roth','converting to roth','backdoor roth'], 0),
  ('roth_ira', 'Roth IRA',
   array['roth','roth ira','roth contribution','fund the roth','max out the roth',
         'contribute to the roth','roth limit'], 1),
  ('side_fund', 'Side Fund',
   array['side fund','side account','side money','sidefund'], 2),
  ('ltc_insurance', 'Long-Term Care Insurance',
   array['long term care','long-term care','ltc','nursing home','home health care'], 3),
  ('money_due', 'Money Due',
   array['money due','money owed','held away','held-away','outside money',
         'money to capture','old 401k','old 401(k)','orphan account'], 4),
  ('life_insurance', 'Life Insurance',
   array['life insurance','term life','whole life','death benefit','iul'], 5),
  ('college_529', '529 / College Funding',
   array['529','college fund','college savings','tuition','education savings'], 6),
  ('estate_beneficiary', 'Estate / Beneficiary Review',
   array['estate plan','estate planning','beneficiary','beneficiaries','living trust',
         'revocable trust','power of attorney','will update','update the will'], 7),
  ('tax_planning', 'Tax Planning',
   array['tax planning','tax strategy','capital gains','tax loss','tax-loss',
         'harvest','cpa','taxable income','bracket'], 8),
  ('annuity_review', 'Annuity Review', array['annuity','annuities'], 9),
  ('rmd', 'RMD', array['rmd','required minimum','required minimum distribution'], 10)
on conflict (id) do nothing;

-- Firm-wide config, same access as service_models: everyone signed in can read
-- and edit it. A tag is a label, not client data, so it crosses no book.
alter table client_tags enable row level security;
drop policy if exists "authenticated all client tags" on client_tags;
create policy "authenticated all client tags" on client_tags
  for all to authenticated using (true) with check (true);

drop trigger if exists client_tags_touch on client_tags;
create trigger client_tags_touch before update on client_tags
  for each row execute function set_updated_at();

-- Live updates, so a tag one person adds appears on everyone else's screen.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'client_tags'
    ) then
      alter publication supabase_realtime add table client_tags;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
