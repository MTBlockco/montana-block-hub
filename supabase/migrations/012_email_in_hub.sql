-- Email Studio moves into the Hub. Mitchell and Brittany (owner + admin) can both approve and send.
-- The lock itself is unchanged: approval is tied to the exact content, any edit cancels it,
-- and status can only move to approved/sent through mkt_approve() or the server's send function.

create or replace function public.mkt_approve(p_id uuid, p_hash text)
returns public.mkt_campaigns
language plpgsql security definer set search_path = public as $$
declare c public.mkt_campaigns; kit jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'Only Mitchell or Brittany can approve emails.';
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

create or replace function public.mkt_set_secret(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then raise exception 'Only Mitchell or Brittany can connect services.'; end if;
  if p_key not in ('omnisend_api_key') then raise exception 'Unknown setting.'; end if;
  if coalesce(trim(p_value), '') = '' then
    delete from public.mkt_private where key = p_key;
  else
    insert into public.mkt_private (key, value, set_by) values (p_key, trim(p_value), auth.uid())
      on conflict (key) do update set value = excluded.value, set_at = now(), set_by = auth.uid();
  end if;
  insert into public.mkt_events (action, detail) values ('service_key_updated', jsonb_build_object('key', p_key, 'cleared', coalesce(trim(p_value),'') = ''));
end $$;

drop policy if exists mkt_campaigns_delete on public.mkt_campaigns;
create policy mkt_campaigns_delete on public.mkt_campaigns for delete to authenticated using (public.has_role('admin'));
