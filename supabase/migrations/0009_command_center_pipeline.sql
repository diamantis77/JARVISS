-- Additive, nullable deal intelligence for deterministic Command Center metrics.
alter table public.leads
  add column if not exists estimated_value numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  add column if not exists currency text not null default 'EUR' check (char_length(currency) = 3),
  add column if not exists deal_stage text check (deal_stage is null or deal_stage in ('new','analyzed','qualified','contacted','interested','proposal','negotiation','won','lost')),
  add column if not exists stage_probability numeric(5,4) check (stage_probability is null or stage_probability between 0 and 1),
  add column if not exists expected_close_at timestamptz,
  add column if not exists won_at timestamptz,
  add column if not exists lost_at timestamptz,
  add column if not exists actual_revenue numeric(14,2) check (actual_revenue is null or actual_revenue >= 0);

create index if not exists leads_user_deal_stage_idx on public.leads(user_id, deal_stage);
create index if not exists leads_user_expected_close_idx on public.leads(user_id, expected_close_at) where expected_close_at is not null;
