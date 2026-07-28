-- 008_industry_mode.sql
-- Give each organization a controlled "industry mode" that drives terminology
-- (e.g. Buyer/Seller vs. Residential/Commercial) and the assistant's self-
-- description. Replaces the old free-text brokerages.industry field in the UI;
-- the free-text column is left in place (non-destructive) and simply unused.
-- Safe to run more than once (idempotent).

alter table brokerages
  add column if not exists industry_mode text default 'home_services';

-- Constrain to the supported modes. Add the check separately so a re-run on a
-- table that already has the column still lands the constraint.
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'brokerages' and constraint_name = 'brokerages_industry_mode_check'
  ) then
    alter table brokerages
      add constraint brokerages_industry_mode_check
      check (industry_mode in ('home_services', 'real_estate'));
  end if;
end $$;

-- Backfill from the old free-text industry text, if that column exists (it was
-- added by migration 002; guard so 008 is safe on any DB state). Anything that
-- reads as real estate becomes real_estate; everything else stays home_services.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'brokerages' and column_name = 'industry'
  ) then
    update brokerages
       set industry_mode = 'real_estate'
     where industry ilike '%real estate%' or industry ilike '%realt%';
  end if;
end $$;

-- New rows already get 'home_services' via the column default; make sure any
-- pre-existing null slipped through gets it too.
update brokerages set industry_mode = 'home_services' where industry_mode is null;
