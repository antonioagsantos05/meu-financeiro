-- Inclui recebimentos do pacote na projecao pela data provisoria, sem aumentar saldo real.
begin;
create or replace function public.get_forecast(start_on date,end_on date,account_ids uuid[] default null,scenario_cents bigint default 0) returns table(day date,real_cents bigint,projected_cents bigint) language plpgsql security invoker set search_path=public,pg_temp as $$
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
 union all
 select (r.payload->>'data')::date,'estimated',(r.payload->>'valor_centavos')::bigint
 from (select distinct on (r.owner_id,r.source_key,r.payload->>'data') r.*
       from financial_import_records r join financial_imports f on f.id=r.import_id
       where r.record_type='income_pending'
       order by r.owner_id,r.source_key,r.payload->>'data',f.created_at desc,r.id) r
 where r.owner_id=auth.uid() and r.record_type='income_pending' and r.linked_id is null
 and r.payload->>'data' is not null and (r.payload->>'valor_centavos')::bigint>0
 and exists(select 1 from acc where bank_code='Santander')
 and not exists(select 1 from transactions t join acc a on a.id=t.account_id
  where t.owner_id=auth.uid() and t.deleted_at is null and t.kind='income'
  and t.amount_cents=(r.payload->>'valor_centavos')::bigint
  and t.occurred_on=(r.payload->>'data')::date)

 ), opening as(select coalesce(sum(opening_balance_cents),0)::bigint v from acc)
 select days.d,(opening.v+coalesce((select sum(e.amount) from events e where e.d<=least(days.d,(now() at time zone 'America/Sao_Paulo')::date) and e.status='confirmed'),0))::bigint,
 (opening.v+coalesce((select sum(e.amount) from events e where e.d<=days.d),0)+scenario_cents)::bigint from days cross join opening order by days.d;
end $$;

commit;
