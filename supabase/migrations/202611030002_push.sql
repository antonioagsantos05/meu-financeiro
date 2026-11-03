create table public.push_subscriptions(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users,
 endpoint text not null unique, p256dh text not null, auth text not null,
 last_seen_at timestamptz not null default now(), revoked_at timestamptz
);
create table public.reminder_deliveries(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users,
 rule_id uuid not null references public.reminder_rules on delete cascade,
 local_date date not null, scheduled_time time not null,
 status text not null check(status in ('claimed','sent','failed','no_subscription')),
 created_at timestamptz not null default now(), unique(rule_id,local_date,scheduled_time)
);
alter table public.push_subscriptions enable row level security;
alter table public.reminder_deliveries enable row level security;
create policy owner_read on public.push_subscriptions for select to authenticated using(owner_id=auth.uid());
create policy owner_read on public.reminder_deliveries for select to authenticated using(owner_id=auth.uid());
revoke all on public.push_subscriptions,public.reminder_deliveries from anon,authenticated;
grant select on public.push_subscriptions,public.reminder_deliveries to authenticated;
grant all on public.push_subscriptions,public.reminder_deliveries to service_role;
create function public.save_push_subscription(subscription jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); e text:=subscription->>'endpoint'; begin
 if u is null then raise exception 'Acesso não autorizado'; end if;
 if e !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/' then raise exception 'Provedor de push não suportado'; end if;
 if length(subscription->'keys'->>'p256dh') not between 40 and 256 or length(subscription->'keys'->>'auth') not between 10 and 128 then raise exception 'Chaves inválidas'; end if;
 if subscription->'keys'->>'p256dh' is null or subscription->'keys'->>'auth' is null then raise exception 'Chaves obrigatórias'; end if;
 insert into push_subscriptions(owner_id,endpoint,p256dh,auth) values(u,e,subscription->'keys'->>'p256dh',subscription->'keys'->>'auth')
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,last_seen_at=now(),revoked_at=null where push_subscriptions.owner_id=u;
 if not found then raise exception 'Subscription já vinculada'; end if;
 if not exists(select 1 from reminder_rules where owner_id=u) then insert into reminder_rules(owner_id,title,local_time) values(u,'Revisar meus gastos','13:30'),(u,'Revisar meus gastos','20:00'); end if;
end $$;
create function public.revoke_push_subscriptions() returns void language sql security definer set search_path=public,pg_temp as $$ update push_subscriptions set revoked_at=now() where owner_id=auth.uid() $$;
revoke all on function public.save_push_subscription(jsonb),public.revoke_push_subscriptions() from public,anon;
grant execute on function public.save_push_subscription(jsonb),public.revoke_push_subscriptions() to authenticated;

grant select on public.reminder_rules to service_role;
