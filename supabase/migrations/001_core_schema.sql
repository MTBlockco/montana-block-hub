-- Montana Block Hub — core schema
-- Roles, in increasing order of access. Enum order is used for comparisons.
create type public.app_role as enum ('pending', 'shop', 'lead', 'admin', 'owner');

-- ---------------------------------------------------------------
-- People
-- ---------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  email           text,
  full_name       text not null default '',
  title           text,
  role            public.app_role not null default 'pending',
  active          boolean not null default true,
  daily_ai_limit  integer not null default 25,
  created_at      timestamptz not null default now()
);

-- Current user's role (inactive or unknown users are treated as pending)
create or replace function public.my_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid() and active),
    'pending'::public.app_role)
$$;

create or replace function public.has_role(min_role public.app_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() >= min_role
$$;

-- Shared updated_at helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

-- ---------------------------------------------------------------
-- SOPs
-- ---------------------------------------------------------------
create table public.sops (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'General',
  body        text not null default '',
  min_role    public.app_role not null default 'shop',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users
);

-- ---------------------------------------------------------------
-- Suppliers & inventory
-- ---------------------------------------------------------------
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  contact_name    text,
  phone           text,
  email           text,
  website         text,
  lead_time_days  integer,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users
);

create table public.inventory_items (
  id             uuid primary key default gen_random_uuid(),
  category       text not null default 'Lumber',   -- Lumber, Finished goods, Finish, Abrasives, Hardware, Shop supplies
  name           text not null,
  species        text,
  thickness      text,                             -- e.g. 8/4
  unit           text not null default 'ea',       -- bf, ea, gal, box
  quantity       numeric not null default 0,
  reorder_point  numeric,
  location       text,
  supplier_id    uuid references public.suppliers on delete set null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users
);

-- ---------------------------------------------------------------
-- Jobs / orders
-- ---------------------------------------------------------------
create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  customer     text,
  channel      text not null default 'Web',       -- Web, Retail, Commercial, Government, Custom
  status       text not null default 'Queued',    -- Queued, Milling, Glue-up, Machining, Sanding, Finishing, QC, Ready, Shipped, Hold
  priority     text not null default 'Normal',    -- Low, Normal, Rush
  due_date     date,
  assigned_to  uuid references public.profiles on delete set null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users
);

-- ---------------------------------------------------------------
-- Announcements / reminders shown on the home screen
-- ---------------------------------------------------------------
create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  due_at      timestamptz,
  min_role    public.app_role not null default 'shop',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users
);

-- ---------------------------------------------------------------
-- Tracking
-- ---------------------------------------------------------------
create table public.activity_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  action      text not null,          -- view_sop, update_inventory, update_job, login ...
  entity      text,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create table public.ai_usage (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users on delete cascade,
  question       text not null,
  answer         text,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cache_read     integer not null default 0,
  cache_write    integer not null default 0,
  cost_usd       numeric(10,6) not null default 0,
  created_at     timestamptz not null default now()
);

create index on public.activity_log (created_at desc);
create index on public.ai_usage (user_id, created_at desc);
create index on public.inventory_items (category, name);
create index on public.jobs (status, due_date);

-- updated_at triggers
create trigger sops_touch            before update on public.sops            for each row execute function public.touch_updated_at();
create trigger suppliers_touch       before update on public.suppliers       for each row execute function public.touch_updated_at();
create trigger inventory_items_touch before update on public.inventory_items for each row execute function public.touch_updated_at();
create trigger jobs_touch            before update on public.jobs            for each row execute function public.touch_updated_at();
create trigger announcements_touch   before update on public.announcements   for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.sops            enable row level security;
alter table public.suppliers       enable row level security;
alter table public.inventory_items enable row level security;
alter table public.jobs            enable row level security;
alter table public.announcements   enable row level security;
alter table public.activity_log    enable row level security;
alter table public.ai_usage        enable row level security;

-- profiles: everyone on the team sees the roster; only the owner edits it directly
-- (user creation and role changes go through the admin-users server function)
create policy profiles_read   on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('shop'));
create policy profiles_update on public.profiles for update to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- SOPs: read if your role meets the SOP's minimum; admins+ write
create policy sops_read  on public.sops for select to authenticated
  using (public.has_role('shop') and public.my_role() >= min_role);
create policy sops_write on public.sops for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- Suppliers: leads+ read, admins+ write
create policy suppliers_read  on public.suppliers for select to authenticated using (public.has_role('lead'));
create policy suppliers_write on public.suppliers for all    to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- Inventory: everyone reads and updates counts; leads+ add; admins+ delete
create policy inventory_read   on public.inventory_items for select to authenticated using (public.has_role('shop'));
create policy inventory_update on public.inventory_items for update to authenticated
  using (public.has_role('shop')) with check (public.has_role('shop'));
create policy inventory_insert on public.inventory_items for insert to authenticated with check (public.has_role('lead'));
create policy inventory_delete on public.inventory_items for delete to authenticated using (public.has_role('admin'));

-- Jobs: everyone reads and updates status/notes; leads+ create; admins+ delete
create policy jobs_read   on public.jobs for select to authenticated using (public.has_role('shop'));
create policy jobs_update on public.jobs for update to authenticated
  using (public.has_role('shop')) with check (public.has_role('shop'));
create policy jobs_insert on public.jobs for insert to authenticated with check (public.has_role('lead'));
create policy jobs_delete on public.jobs for delete to authenticated using (public.has_role('admin'));

-- Announcements: read if role meets minimum; admins+ write
create policy announcements_read  on public.announcements for select to authenticated
  using (public.has_role('shop') and public.my_role() >= min_role);
create policy announcements_write on public.announcements for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- Activity log: each person writes their own entries; admins+ read all
create policy activity_insert on public.activity_log for insert to authenticated
  with check (user_id = auth.uid() and public.has_role('shop'));
create policy activity_read   on public.activity_log for select to authenticated
  using (public.has_role('admin'));

-- AI usage: written only by the server function; you see your own, admins+ see all
create policy ai_usage_read on public.ai_usage for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));

-- Lock helper functions to signed-in users
revoke execute on function public.my_role() from anon, public;
revoke execute on function public.has_role(public.app_role) from anon, public;
grant  execute on function public.my_role() to authenticated;
grant  execute on function public.has_role(public.app_role) to authenticated;
