-- Montana Block Email Studio
-- Campaign drafts, brand kit, approvals and send log for the marketing email app (/email-studio).
--
-- THE RULE: nothing goes out without Mitchell's explicit approval.
--  * Only the owner can approve, and only through mkt_approve(), which records exactly what was approved (content hash).
--  * Any edit to an approved email's subject, preheader, body or audience automatically cancels the approval.
--  * Status can only move to approved / scheduled / sending / sent through mkt_approve() or the server's send function.
--  * The send function re-checks owner, status, and that the content still matches what was approved, and needs a typed SEND.

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table public.mkt_brand (
  id          int primary key default 1 check (id = 1),
  kit         jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users
);

create table public.mkt_campaigns (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'campaign' check (kind in ('campaign', 'flow')),
  flow_name       text,                 -- for flow emails: Welcome, Abandoned cart, ...
  flow_step       int,
  title           text not null default 'Untitled email',
  goal            text,
  persona         text,
  planned_at      timestamptz,          -- calendar slot
  status          text not null default 'planned'
                  check (status in ('planned','draft','approved','scheduled','sending','sent','rejected','archived')),
  subject         text,
  subject_options jsonb not null default '[]'::jsonb,
  preheader       text,
  theme           jsonb not null default '{}'::jsonb,
  blocks          jsonb not null default '[]'::jsonb,
  html            text,
  hero_svg        text,
  hero_url        text,
  audience        jsonb not null default '{"type":"all","label":"All subscribers"}'::jsonb,
  brief           jsonb not null default '{}'::jsonb,
  notes           text,
  content_hash    text,
  approved_by     uuid references auth.users,
  approved_at     timestamptz,
  approved_hash   text,
  send_at         timestamptz,
  esp             text,
  esp_campaign_id text,
  esp_status      text,
  sent_at         timestamptz,
  stats           jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users
);
create index mkt_campaigns_planned_idx on public.mkt_campaigns (planned_at);

create table public.mkt_events (
  id           bigint generated always as identity primary key,
  campaign_id  uuid references public.mkt_campaigns on delete cascade,
  actor        uuid references auth.users default auth.uid(),
  action       text not null,
  detail       jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);
create index mkt_events_campaign_idx on public.mkt_events (campaign_id, at desc);

create table public.mkt_ai_log (
  id             bigint generated always as identity primary key,
  user_id        uuid references auth.users,
  campaign_id    uuid references public.mkt_campaigns on delete set null,
  action         text,
  model          text,
  input_tokens   int,
  output_tokens  int,
  created_at     timestamptz not null default now()
);

-- Secrets (Omnisend API key). No policies: only the server can read it.
create table public.mkt_private (
  key    text primary key,
  value  text not null,
  set_at timestamptz not null default now(),
  set_by uuid references auth.users
);

-- ---------------------------------------------------------------
-- Approval lock
-- ---------------------------------------------------------------
create or replace function public.mkt_hash(subject text, preheader text, html text, audience jsonb)
returns text language sql immutable as $$
  select md5(coalesce(subject,'') || '|' || coalesce(preheader,'') || '|' || coalesce(html,'') || '|' || coalesce(audience::text,''))
$$;

create or replace function public.mkt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  trusted boolean := coalesce(current_setting('mkt.trusted', true), '') = 'on'
                     or coalesce(auth.role(), '') = 'service_role';
  locked_states text[] := array['approved','scheduled','sending','sent'];
begin
  new.content_hash := public.mkt_hash(new.subject, new.preheader, new.html, new.audience);
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    if new.status = any(locked_states) and not trusted then
      raise exception 'A new email can''t start out approved. Approve it with the Approve button.';
    end if;
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
    return new;
  end if;

  -- Once it's with the email service or out the door, the content is frozen.
  if old.status in ('scheduled','sending','sent') and not trusted
     and (new.content_hash is distinct from old.content_hash or new.status is distinct from old.status) then
    raise exception 'This email has already been handed to the email service and can''t be changed. Duplicate it instead.';
  end if;

  -- Approval fields can only be written by the approval function or the server.
  if not trusted and (new.approved_by is distinct from old.approved_by
                      or new.approved_at is distinct from old.approved_at
                      or new.approved_hash is distinct from old.approved_hash
                      or new.esp_campaign_id is distinct from old.esp_campaign_id
                      or new.sent_at is distinct from old.sent_at) then
    raise exception 'Approval and send records can only be changed by the Approve and Send buttons.';
  end if;

  -- Moving into an approved/sent state takes the Approve button (or the server).
  if new.status = any(locked_states) and new.status is distinct from old.status and not trusted then
    raise exception 'Only Mitchell''s Approve button can approve an email.';
  end if;

  -- Any change to what the reader would get cancels the approval.
  if old.status = 'approved' and new.content_hash is distinct from old.approved_hash then
    new.status := 'draft';
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
    insert into public.mkt_events (campaign_id, action, detail)
      values (new.id, 'approval_revoked', jsonb_build_object('reason', 'content edited after approval'));
  end if;

  -- Un-approving by hand also clears the record.
  if old.status = 'approved' and new.status in ('draft','planned','rejected','archived') then
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
  end if;
  return new;
end $$;

create trigger mkt_campaigns_guard
  before insert or update on public.mkt_campaigns
  for each row execute function public.mkt_guard();

-- Deleting anything that has gone out is not allowed (keeps the record).
create or replace function public.mkt_no_delete_sent()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status in ('scheduled','sending','sent') and coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Emails that went to the email service stay on record. Archive it instead.';
  end if;
  return old;
end $$;
create trigger mkt_campaigns_no_delete before delete on public.mkt_campaigns
  for each row execute function public.mkt_no_delete_sent();

-- The one way to approve: owner only, and only the exact version on screen (by hash).
create or replace function public.mkt_approve(p_id uuid, p_hash text)
returns public.mkt_campaigns
language plpgsql security definer set search_path = public as $$
declare c public.mkt_campaigns; kit jsonb;
begin
  if public.my_role() <> 'owner' then
    raise exception 'Only the owner can approve emails.';
  end if;
  select * into c from public.mkt_campaigns where id = p_id for update;
  if not found then raise exception 'Email not found.'; end if;
  if c.status <> 'draft' then raise exception 'Only drafts can be approved (this one is %).', c.status; end if;
  if coalesce(c.subject,'') = '' or coalesce(c.html,'') = '' then
    raise exception 'This email needs a subject and a body before it can be approved.';
  end if;
  if c.content_hash is distinct from p_hash then
    raise exception 'This email changed since you opened it. Review the latest version, then approve.';
  end if;
  if position('[[unsubscribe_link]]' in c.html) = 0 then
    raise exception 'The email is missing its unsubscribe link.';
  end if;
  select b.kit into kit from public.mkt_brand b where b.id = 1;
  if coalesce(kit->>'address','') = '' then
    raise exception 'Add the business mailing address in Brand Kit first (the law requires it in every marketing email).';
  end if;

  perform set_config('mkt.trusted', 'on', true);
  update public.mkt_campaigns
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), approved_hash = c.content_hash
   where id = p_id
   returning * into c;
  perform set_config('mkt.trusted', 'off', true);

  insert into public.mkt_events (campaign_id, action, detail)
    values (p_id, 'approved', jsonb_build_object('hash', c.approved_hash, 'subject', c.subject, 'audience', c.audience));
  return c;
end $$;

create or replace function public.mkt_unapprove(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then raise exception 'Not allowed.'; end if;
  update public.mkt_campaigns set status = 'draft' where id = p_id and status = 'approved';
  insert into public.mkt_events (campaign_id, action) values (p_id, 'unapproved');
end $$;

-- Owner saves the email service key; it's never readable from the app.
create or replace function public.mkt_set_secret(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'Only the owner can connect services.'; end if;
  if p_key not in ('omnisend_api_key') then raise exception 'Unknown setting.'; end if;
  if coalesce(trim(p_value), '') = '' then
    delete from public.mkt_private where key = p_key;
  else
    insert into public.mkt_private (key, value, set_by) values (p_key, trim(p_value), auth.uid())
      on conflict (key) do update set value = excluded.value, set_at = now(), set_by = auth.uid();
  end if;
  insert into public.mkt_events (action, detail) values ('service_key_updated', jsonb_build_object('key', p_key, 'cleared', coalesce(trim(p_value),'') = ''));
end $$;

create or replace function public.mkt_secret_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.has_role('admin')
    then coalesce((select jsonb_object_agg(key, jsonb_build_object('set', true, 'set_at', set_at, 'last4', right(value, 4))) from public.mkt_private), '{}'::jsonb)
    else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------
-- Access: Email Studio is for admins and the owner. Approval is owner-only (above).
-- ---------------------------------------------------------------
alter table public.mkt_brand     enable row level security;
alter table public.mkt_campaigns enable row level security;
alter table public.mkt_events    enable row level security;
alter table public.mkt_ai_log    enable row level security;
alter table public.mkt_private   enable row level security;

create policy mkt_brand_read  on public.mkt_brand for select to authenticated using (public.has_role('admin'));
create policy mkt_brand_write on public.mkt_brand for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy mkt_campaigns_read   on public.mkt_campaigns for select to authenticated using (public.has_role('admin'));
create policy mkt_campaigns_insert on public.mkt_campaigns for insert to authenticated with check (public.has_role('admin'));
create policy mkt_campaigns_update on public.mkt_campaigns for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy mkt_campaigns_delete on public.mkt_campaigns for delete to authenticated using (public.has_role('owner'));

create policy mkt_events_read   on public.mkt_events for select to authenticated using (public.has_role('admin'));
create policy mkt_events_insert on public.mkt_events for insert to authenticated
  with check (public.has_role('admin') and action in ('note','generated','edited','test_requested','duplicated','rejected'));

create policy mkt_ai_log_read on public.mkt_ai_log for select to authenticated using (public.has_role('admin'));

revoke all on function public.mkt_approve(uuid, text) from public, anon;
revoke all on function public.mkt_unapprove(uuid) from public, anon;
revoke all on function public.mkt_set_secret(text, text) from public, anon;
grant execute on function public.mkt_approve(uuid, text) to authenticated;
grant execute on function public.mkt_unapprove(uuid) to authenticated;
grant execute on function public.mkt_set_secret(text, text) to authenticated;
grant execute on function public.mkt_secret_status() to authenticated;

-- Public bucket for email graphics (emails need public image links). Only admins+ can upload.
insert into storage.buckets (id, name, public) values ('mkt-assets', 'mkt-assets', true)
  on conflict (id) do nothing;
create policy mkt_assets_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'mkt-assets' and public.has_role('admin'));
create policy mkt_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'mkt-assets' and public.has_role('admin'));
