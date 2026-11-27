-- Copies of what live Omnisend emails look like (Omnisend's API doesn't return their designs), so the Hub can preview them.
create table if not exists public.mkt_omni_previews (
  omni_id text primary key,
  kind text not null check (kind in ('automation','campaign')),
  name text,
  subject text,
  html text not null,
  captured_at timestamptz not null default now(),
  captured_by uuid default auth.uid()
);
alter table public.mkt_omni_previews enable row level security;
create policy "admins read previews" on public.mkt_omni_previews for select using (public.has_role('admin'));
create policy "admins write previews" on public.mkt_omni_previews for insert with check (public.has_role('admin'));
create policy "admins update previews" on public.mkt_omni_previews for update using (public.has_role('admin'));
