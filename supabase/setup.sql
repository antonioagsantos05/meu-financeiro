-- Instalacao inicial do Meu Financeiro em banco vazio.
-- Execute este arquivo UMA vez no SQL Editor do Supabase.
-- Alternativa as migracoes individuais: nao execute ambos.
-- Nenhum saldo, conta ou movimento ilustrativo sera inserido.
begin;

-- 202611030001_initial.sql
create extension if not exists pgcrypto;
create table public.accounts(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, name text not null, bank_code text not null check(bank_code in ('Nubank','Santander','Itaú')), opening_balance_cents bigint not null default 0, overdraft_limit_cents bigint not null default 0 check(overdraft_limit_cents>=0), active boolean not null default true, version int not null default 1, unique(owner_id,id));
create table public.cards(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, name text not null, account_id uuid, closing_day int not null check(closing_day between 1 and 31), due_day int not null check(due_day between 1 and 31), active boolean not null default true, unique(owner_id,id), foreign key(owner_id,account_id) references public.accounts(owner_id,id));
create table public.tags(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, name text not null, normalized_name text generated always as (lower(trim(name))) stored, deleted_at timestamptz, unique(owner_id,id));
create unique index tags_active_name on public.tags(owner_id,normalized_name) where deleted_at is null;
create table public.transactions(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, kind text not null check(kind in ('income','expense','transfer')), description text not null check(length(trim(description))>0), amount_cents bigint not null check(amount_cents>0), occurred_on date not null, status text not null check(status in ('confirmed','scheduled','estimated')), payment_method text not null check(payment_method in ('pix','debit','credit','transfer')), account_id uuid, destination_account_id uuid, card_id uuid, tag_ids uuid[] not null default '{}', source_type text not null default 'manual', version int not null default 1, deleted_at timestamptz, unique(owner_id,id), foreign key(owner_id,account_id) references public.accounts(owner_id,id), foreign key(owner_id,destination_account_id) references public.accounts(owner_id,id), foreign key(owner_id,card_id) references public.cards(owner_id,id), check((kind='transfer' and payment_method='transfer' and account_id is not null and destination_account_id is not null and account_id<>destination_account_id and card_id is null) or (kind<>'transfer' and destination_account_id is null and ((payment_method in ('pix','debit') and account_id is not null and card_id is null) or (kind='expense' and payment_method='credit' and card_id is not null and account_id is null)))));
create table public.invoices(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, card_id uuid not null, period_key text not null, closing_on date not null, due_on date not null, status text not null default 'open' check(status in ('open','partial','paid')), total_cents bigint not null default 0 check(total_cents>=0), paid_cents bigint not null default 0 check(paid_cents>=0 and paid_cents<=total_cents), unique(owner_id,id), unique(card_id,period_key), foreign key(owner_id,card_id) references public.cards(owner_id,id));
create table public.installment_plans(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, transaction_id uuid not null unique, installment_count int not null check(installment_count between 1 and 120), total_cents bigint not null check(total_cents>0), status text not null default 'open', version int not null default 1, unique(owner_id,id), foreign key(owner_id,transaction_id) references public.transactions(owner_id,id));
create table public.installments(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, plan_id uuid not null, ordinal int not null check(ordinal>0), amount_cents bigint not null check(amount_cents>0), invoice_id uuid not null, due_on date not null, status text not null default 'open' check(status in ('open','paid','settled','cancelled')), settled_at timestamptz, unique(plan_id,ordinal), foreign key(owner_id,plan_id) references public.installment_plans(owner_id,id), foreign key(owner_id,invoice_id) references public.invoices(owner_id,id));
create table public.payments(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, kind text not null, account_id uuid not null, invoice_id uuid, installment_plan_id uuid, amount_cents bigint not null check(amount_cents>0), paid_on date not null, idempotency_key uuid not null, unique(owner_id,idempotency_key), foreign key(owner_id,account_id) references public.accounts(owner_id,id), foreign key(owner_id,invoice_id) references public.invoices(owner_id,id), foreign key(owner_id,installment_plan_id) references public.installment_plans(owner_id,id));
create table public.recurrence_rules(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, description text not null, kind text not null check(kind in ('income','expense')), amount_cents bigint not null check(amount_cents>0), account_id uuid not null, day int not null check(day between 1 and 31), start_on date not null, end_on date, active boolean not null default true, unique(owner_id,id), foreign key(owner_id,account_id) references public.accounts(owner_id,id), check(end_on is null or end_on>=start_on));
create table public.recurrence_occurrences(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, rule_id uuid not null, occurrence_date date not null, transaction_id uuid not null, unique(rule_id,occurrence_date), foreign key(owner_id,rule_id) references public.recurrence_rules(owner_id,id), foreign key(owner_id,transaction_id) references public.transactions(owner_id,id));
create table public.reminder_rules(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, title text not null, local_time time not null, weekdays int[] not null default '{1,2,3,4,5,6,7}', timezone text not null default 'America/Sao_Paulo', enabled boolean not null default true, privacy_mode boolean not null default true, check(weekdays <@ array[1,2,3,4,5,6,7]));
create table public.daily_reviews(owner_id uuid not null default auth.uid() references auth.users, local_date date not null, reviewed_at timestamptz not null default now(), had_spending boolean not null, primary key(owner_id,local_date));
create table public.audit_events(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users, entity_type text not null, entity_id uuid, action text not null, before_json jsonb, after_json jsonb, at timestamptz not null default now());
create table public.idempotency_keys(owner_id uuid not null references auth.users, key uuid not null, operation text not null, request_json jsonb not null, result_json jsonb, created_at timestamptz not null default now(), primary key(owner_id,key));
create index transactions_owner_date on public.transactions(owner_id,occurred_on);
create index installments_invoice on public.installments(invoice_id,status);
create index payments_owner_date on public.payments(owner_id,paid_on);

do $$ declare t text; begin
 foreach t in array array['accounts','cards','tags','transactions','invoices','installment_plans','installments','payments','recurrence_rules','recurrence_occurrences','reminder_rules','daily_reviews','audit_events','idempotency_keys'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_select on public.%I for select to authenticated using(owner_id=auth.uid())',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;

create function public.audit_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 insert into audit_events(owner_id,entity_type,entity_id,action,before_json,after_json) values(coalesce(new.owner_id,old.owner_id),tg_table_name,coalesce(new.id,old.id),tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
 return coalesce(new,old); end $$;
do $$ declare t text; begin foreach t in array array['accounts','cards','tags','transactions','invoices','installment_plans','installments','payments','recurrence_rules','reminder_rules'] loop execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_change()',t); end loop; end $$;

create function public.civil_day(month_date date, day_number int) returns date language sql immutable set search_path=public,pg_temp as $$ select (date_trunc('month',month_date)::date + (least(day_number,extract(day from (date_trunc('month',month_date)+interval '1 month - 1 day'))::int)-1))::date $$;

-- Single authenticated command gateway: no direct writes to financial tables.
create function public.command(operation text, payload jsonb, request_key uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 u uuid:=auth.uid(); prior idempotency_keys%rowtype; result jsonb:='{}'; obj uuid; a accounts%rowtype; tx transactions%rowtype; c cards%rowtype; inv invoices%rowtype; p installment_plans%rowtype; rr recurrence_rules%rowtype;
 amount bigint; n int; i int; due date; closing date; base date; part bigint; inv_id uuid; created_plan_id uuid; pending bigint; dt date; month_date date; new_tx uuid; r record;
begin
 if u is null then raise exception 'Acesso não autorizado'; end if;
 if request_key is null then raise exception 'Chave de idempotência obrigatória'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into prior from idempotency_keys where owner_id=u and key=request_key;
 if found then
  if prior.operation<>operation or prior.request_json<>payload then raise exception 'Chave reutilizada com outros dados'; end if;
  return prior.result_json;
 end if;
 insert into idempotency_keys(owner_id,key,operation,request_json) values(u,request_key,operation,payload);
 obj:=nullif(payload->>'id','')::uuid;
 if operation='save_account' then
  if obj is null then
   insert into accounts(owner_id,name,bank_code,opening_balance_cents,overdraft_limit_cents) values(u,trim(payload->>'name'),payload->>'bank_code',(payload->>'opening_balance_cents')::bigint,(payload->>'overdraft_limit_cents')::bigint) returning id into obj;
  else
   select * into a from accounts where id=obj and owner_id=u for update;
   if not found or a.version is distinct from (payload->>'version')::int then raise exception 'Conta alterada. Atualize a página.'; end if;
   if a.opening_balance_cents<>(payload->>'opening_balance_cents')::bigint and (exists(select 1 from transactions where owner_id=u and (account_id=obj or destination_account_id=obj)) or exists(select 1 from payments where owner_id=u and account_id=obj)) then raise exception 'Saldo inicial bloqueado após movimentação. Registre um ajuste como movimento.'; end if;
   update accounts set name=trim(payload->>'name'), opening_balance_cents=(payload->>'opening_balance_cents')::bigint, overdraft_limit_cents=(payload->>'overdraft_limit_cents')::bigint, version=version+1 where id=obj;
  end if;
 elsif operation='save_card' then
  if obj is not null then raise exception 'Crie outro cartão para novos ciclos; ciclos históricos são preservados.'; end if;
  insert into cards(owner_id,name,account_id,closing_day,due_day) values(u,trim(payload->>'name'),nullif(payload->>'account_id','')::uuid,(payload->>'closing_day')::int,(payload->>'due_day')::int) returning id into obj;
 elsif operation='save_tag' then
  if length(trim(payload->>'name'))=0 then raise exception 'Nome obrigatório'; end if;
  if obj is null then insert into tags(owner_id,name) values(u,trim(payload->>'name')) returning id into obj;
  else update tags set name=trim(payload->>'name') where id=obj and owner_id=u and deleted_at is null; if not found then raise exception 'Tag não encontrada'; end if; end if;
 elsif operation='delete_tag' then
  update tags set deleted_at=now() where id=obj and owner_id=u;
 elsif operation in ('create_transaction','update_transaction','delete_transaction') then
  if obj is not null then
   select * into tx from transactions where owner_id=u and id=obj and deleted_at is null for update;
   if not found or tx.version is distinct from (payload->>'version')::int then raise exception 'Movimento alterado. Atualize a página.'; end if;
   if operation='update_transaction' and tx.status='confirmed' and tx.payment_method<>'credit' and (
     tx.amount_cents is distinct from (payload->>'amount_cents')::bigint or
     tx.occurred_on is distinct from (payload->>'occurred_on')::date or
     tx.kind is distinct from payload->>'kind' or
     tx.payment_method is distinct from payload->>'payment_method' or
     tx.account_id is distinct from nullif(payload->>'account_id','')::uuid or
     tx.destination_account_id is distinct from nullif(payload->>'destination_account_id','')::uuid or
     payload->>'status'<>'confirmed'
   ) then raise exception 'Movimento efetivado: preserve os valores e registre um ajuste separado ou exclua com motivo para corrigir.'; end if;
   if tx.payment_method='credit' and exists(select 1 from installment_plans ip join installments it on it.plan_id=ip.id join invoices f on f.id=it.invoice_id where ip.transaction_id=obj and (it.status<>'open' or f.paid_cents>0)) then raise exception 'Há pagamentos ou quitação. Alteração destrutiva bloqueada.'; end if;
   if tx.payment_method='credit' then
    for r in select it.invoice_id,sum(it.amount_cents) total from installments it join installment_plans ip on ip.id=it.plan_id where ip.transaction_id=obj group by it.invoice_id loop update invoices set total_cents=total_cents-r.total where id=r.invoice_id; end loop;
    delete from installments where plan_id in(select id from installment_plans where transaction_id=obj);
    delete from installment_plans where transaction_id=obj;
   end if;
  elsif operation<>'create_transaction' then raise exception 'Movimento obrigatório'; end if;
  if operation='delete_transaction' then
   if length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Motivo obrigatório'; end if;
   update transactions set deleted_at=now(),version=version+1 where id=obj;
   insert into audit_events(owner_id,entity_type,entity_id,action,after_json) values(u,'transactions',obj,'delete_reason',jsonb_build_object('reason',payload->>'reason'));
  else
   if exists(select 1 from jsonb_array_elements_text(coalesce(payload->'tag_ids','[]')) tag where not exists(select 1 from tags where id=tag::uuid and owner_id=u and deleted_at is null)) then raise exception 'Tag inválida'; end if;
   if obj is null then
    insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,destination_account_id,card_id,tag_ids) values(u,payload->>'kind',trim(payload->>'description'),(payload->>'amount_cents')::bigint,(payload->>'occurred_on')::date,payload->>'status',payload->>'payment_method',nullif(payload->>'account_id','')::uuid,nullif(payload->>'destination_account_id','')::uuid,nullif(payload->>'card_id','')::uuid,array(select jsonb_array_elements_text(coalesce(payload->'tag_ids','[]')))::uuid[]) returning id into obj;
   else
    update transactions set kind=payload->>'kind',description=trim(payload->>'description'),amount_cents=(payload->>'amount_cents')::bigint,occurred_on=(payload->>'occurred_on')::date,status=payload->>'status',payment_method=payload->>'payment_method',account_id=nullif(payload->>'account_id','')::uuid,destination_account_id=nullif(payload->>'destination_account_id','')::uuid,card_id=nullif(payload->>'card_id','')::uuid,tag_ids=array(select jsonb_array_elements_text(coalesce(payload->'tag_ids','[]')))::uuid[],version=version+1 where id=obj;
   end if;
   select * into tx from transactions where id=obj;
   if tx.payment_method='credit' then
    n:=(payload->>'installment_count')::int;
    if n is null or n<1 or n>120 or tx.amount_cents<n then raise exception 'Número de parcelas inválido'; end if;
    select * into c from cards where id=tx.card_id and owner_id=u and active;
    if not found then raise exception 'Cartão não encontrado'; end if;
    closing:=civil_day(tx.occurred_on,c.closing_day);
    if tx.occurred_on>=closing then closing:=civil_day((date_trunc('month',tx.occurred_on)+interval '1 month')::date,c.closing_day); end if;
    base:=date_trunc('month',closing)::date;
    insert into installment_plans(owner_id,transaction_id,installment_count,total_cents) values(u,obj,n,tx.amount_cents) returning id into created_plan_id;
    for i in 0..n-1 loop
     closing:=civil_day((base+make_interval(months=>i))::date,c.closing_day);
     due:=civil_day(closing,c.due_day);
     if due<=closing then due:=civil_day((date_trunc('month',closing)+interval '1 month')::date,c.due_day); end if;
     insert into invoices(owner_id,card_id,period_key,closing_on,due_on) values(u,c.id,to_char(closing,'YYYY-MM'),closing,due) on conflict(card_id,period_key) do nothing;
     select * into inv from invoices where card_id=c.id and period_key=to_char(closing,'YYYY-MM') for update;
     if inv.paid_cents>0 then raise exception 'Fatura com pagamento não aceita reescrita; registre ajuste separado.'; end if;
     inv_id:=inv.id;
     part:=tx.amount_cents/n+case when i<tx.amount_cents%n then 1 else 0 end;
     insert into installments(owner_id,plan_id,ordinal,amount_cents,invoice_id,due_on) values(u,created_plan_id,i+1,part,inv_id,due);
     update invoices set total_cents=total_cents+part,status='open' where id=inv_id;
    end loop;
   end if;
  end if;
 elsif operation='pay_invoice' then
  select * into inv from invoices where id=obj and owner_id=u for update;
  if not found then raise exception 'Fatura não encontrada'; end if;
  amount:=(payload->>'amount_cents')::bigint;
  if amount is null or amount<=0 or amount>inv.total_cents-inv.paid_cents then raise exception 'Valor excede o saldo da fatura'; end if;
  if (payload->>'paid_on')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Pagamento efetivo não pode ser futuro'; end if;
  insert into payments(owner_id,kind,account_id,invoice_id,amount_cents,paid_on,idempotency_key) values(u,'invoice',(payload->>'account_id')::uuid,obj,amount,(payload->>'paid_on')::date,request_key);
  update invoices set paid_cents=paid_cents+amount,status=case when paid_cents+amount=total_cents then 'paid' else 'partial' end where id=obj;
  if inv.paid_cents+amount=inv.total_cents then update installments set status='paid',settled_at=now() where invoice_id=obj and status='open'; end if;
 elsif operation='settle_installment_plan' then
  select * into p from installment_plans where id=obj and owner_id=u for update;
  if not found or p.status<>'open' or p.version is distinct from (payload->>'version')::int then raise exception 'Plano alterado ou já quitado'; end if;
  if coalesce((payload->>'issuer_confirmed')::boolean,false)=false then raise exception 'Confirme antecipação efetiva no emissor'; end if;
  if exists(select 1 from installments it join invoices f on f.id=it.invoice_id where it.plan_id=obj and it.status='open' and f.paid_cents>0) then raise exception 'Conclua faturas parcialmente pagas antes da quitação'; end if;
  amount:=(payload->>'amount_cents')::bigint;
  if (payload->>'paid_on')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Pagamento efetivo não pode ser futuro'; end if;
  select sum(amount_cents) into pending from installments where plan_id=obj and status='open';
  if coalesce(pending,0)=0 then raise exception 'Sem parcelas pendentes'; end if;
  insert into payments(owner_id,kind,account_id,installment_plan_id,amount_cents,paid_on,idempotency_key) values(u,'settlement',(payload->>'account_id')::uuid,obj,amount,(payload->>'paid_on')::date,request_key);
  for r in select invoice_id,sum(amount_cents) total from installments where plan_id=obj and status='open' group by invoice_id loop
   update invoices set total_cents=total_cents-r.total,status=case when total_cents-r.total=paid_cents then 'paid' else 'open' end where id=r.invoice_id;
  end loop;
  update installments set status='settled',settled_at=now() where plan_id=obj and status='open';
  update installment_plans set status='settled',version=version+1 where id=obj;
  insert into audit_events(owner_id,entity_type,entity_id,action,after_json) values(u,'installment_plans',obj,'settlement_adjustment',jsonb_build_object('original_pending_cents',pending,'paid_cents',amount,'adjustment_cents',amount-pending));
 elsif operation='save_recurrence' then
  if obj is null then
   insert into recurrence_rules(owner_id,description,kind,amount_cents,account_id,day,start_on,end_on) values(u,payload->>'description',payload->>'kind',(payload->>'amount_cents')::bigint,(payload->>'account_id')::uuid,(payload->>'day')::int,(payload->>'start_on')::date,nullif(payload->>'end_on','')::date) returning id into obj;
  else
   update recurrence_rules set description=payload->>'description',amount_cents=(payload->>'amount_cents')::bigint,day=(payload->>'day')::int,end_on=nullif(payload->>'end_on','')::date,active=(payload->>'active')::boolean where id=obj and owner_id=u;
  end if;
 elsif operation='toggle_recurrence' then update recurrence_rules set active=not active where id=obj and owner_id=u;
 elsif operation='generate_recurrences' then
  if (payload->>'end_on')::date-(payload->>'start_on')::date not between 0 and 730 then raise exception 'Horizonte máximo de 730 dias'; end if;
  for rr in select * from recurrence_rules where owner_id=u and active loop
   for month_date in select generate_series(date_trunc('month',(payload->>'start_on')::date),date_trunc('month',(payload->>'end_on')::date),'1 month')::date loop
    dt:=civil_day(month_date,rr.day);
    if dt>=greatest(rr.start_on,(payload->>'start_on')::date) and dt<=least(coalesce(rr.end_on,(payload->>'end_on')::date),(payload->>'end_on')::date) and not exists(select 1 from recurrence_occurrences where rule_id=rr.id and occurrence_date=dt) then
     insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,source_type) values(u,rr.kind,rr.description,rr.amount_cents,dt,'estimated','pix',rr.account_id,'recurrence') returning id into new_tx;
     insert into recurrence_occurrences(owner_id,rule_id,occurrence_date,transaction_id) values(u,rr.id,dt,new_tx);
    end if;
   end loop;
  end loop;
 elsif operation='save_reminder' then
  if obj is null then insert into reminder_rules(owner_id,title,local_time,weekdays) values(u,payload->>'title',(payload->>'local_time')::time,array(select jsonb_array_elements_text(payload->'weekdays'))::int[]) returning id into obj;
  else update reminder_rules set title=payload->>'title',local_time=(payload->>'local_time')::time,weekdays=array(select jsonb_array_elements_text(payload->'weekdays'))::int[],enabled=(payload->>'enabled')::boolean where id=obj and owner_id=u; end if;
 elsif operation='delete_reminder' then delete from reminder_rules where id=obj and owner_id=u;
 elsif operation='mark_daily_review' then
  dt:=(now() at time zone 'America/Sao_Paulo')::date;
  insert into daily_reviews(owner_id,local_date,had_spending) values(u,dt,(payload->>'had_spending')::boolean) on conflict(owner_id,local_date) do update set had_spending=excluded.had_spending,reviewed_at=now();
 else raise exception 'Operação desconhecida'; end if;
 result:=jsonb_build_object('id',obj,'ok',true);
 update idempotency_keys set result_json=result where owner_id=u and key=request_key;
 return result;
end $$;

create function public.get_forecast(start_on date,end_on date,account_ids uuid[] default null,scenario_cents bigint default 0) returns table(day date,real_cents bigint,projected_cents bigint) language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if end_on-start_on not between 0 and 730 then raise exception 'Horizonte máximo de 730 dias'; end if;
 return query
 with days as(select generate_series(start_on,end_on,'1 day')::date d),
 acc as(select * from accounts where owner_id=auth.uid() and (account_ids is null or id=any(account_ids))),
 events as(
 select t.occurred_on d,t.status,sum(case when t.kind='income' then t.amount_cents else -t.amount_cents end) amount from transactions t join acc a on a.id=t.account_id where t.deleted_at is null and t.payment_method<>'credit' group by t.occurred_on,t.status
 union all select t.occurred_on,t.status,t.amount_cents from transactions t join acc a on a.id=t.destination_account_id where t.deleted_at is null and t.kind='transfer'
 union all select p.paid_on,'confirmed',-p.amount_cents from payments p join acc a on a.id=p.account_id
 union all select f.due_on,'scheduled',-(f.total_cents-f.paid_cents) from invoices f join cards c on c.id=f.card_id where f.total_cents>f.paid_cents and (account_ids is null or c.account_id=any(account_ids))
 ), opening as(select coalesce(sum(opening_balance_cents),0)::bigint v from acc)
 select days.d,(opening.v+coalesce((select sum(e.amount) from events e where e.d<=least(days.d,(now() at time zone 'America/Sao_Paulo')::date) and e.status='confirmed'),0))::bigint,
 (opening.v+coalesce((select sum(e.amount) from events e where e.d<=days.d),0)+scenario_cents)::bigint from days cross join opening order by days.d;
end $$;

do $$ declare f record; begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('command','get_forecast','civil_day','audit_change') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop; end $$;
grant execute on function public.command(text,jsonb,uuid) to authenticated;
grant execute on function public.get_forecast(date,date,uuid[],bigint) to authenticated;

-- Values are bounded below JS safe-integer limits; large portfolios still need aggregate limits.
alter table public.accounts add constraint account_name_valid check(length(trim(name)) between 1 and 100);
alter table public.accounts add constraint account_amount_bounds check(abs(opening_balance_cents)<=1000000000000 and overdraft_limit_cents<=1000000000000);
alter table public.cards add constraint card_name_valid check(length(trim(name)) between 1 and 100);
alter table public.transactions add constraint transaction_amount_bounds check(amount_cents<=1000000000000);
alter table public.recurrence_rules add constraint recurrence_amount_bounds check(amount_cents<=1000000000000);
alter table public.reminder_rules add constraint reminder_days_valid check(cardinality(weekdays)>0);
create function public.get_account_balances() returns table(account_id uuid,balance_cents bigint) language sql security invoker set search_path=public,pg_temp as $$
 select a.id,(a.opening_balance_cents+
 coalesce((select sum(case when t.account_id=a.id then case when t.kind='income' then t.amount_cents else -t.amount_cents end else 0 end +case when t.destination_account_id=a.id then t.amount_cents else 0 end) from transactions t where t.owner_id=auth.uid() and t.deleted_at is null and t.status='confirmed' and t.payment_method<>'credit' and t.occurred_on<=(now() at time zone 'America/Sao_Paulo')::date),0)
 -coalesce((select sum(p.amount_cents) from payments p where p.owner_id=auth.uid() and p.account_id=a.id and p.paid_on<=(now() at time zone 'America/Sao_Paulo')::date),0))::bigint
 from accounts a where a.owner_id=auth.uid();
$$;
revoke all on function public.get_account_balances() from public,anon;
grant execute on function public.get_account_balances() to authenticated;


-- 202611030002_push.sql
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


commit;
