begin;
alter table public.payments add column reversed_at timestamptz;
alter table public.payments add column reversal_reason text;
alter table public.transactions add column paid_on date;
alter table public.transactions add column related_bank_code text;
alter table public.financial_import_records add column version int not null default 1;
create or replace function public.get_forecast(start_on date,end_on date,account_ids uuid[] default null,scenario_cents bigint default 0) returns table(day date,real_cents bigint,projected_cents bigint) language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if end_on-start_on not between 0 and 730 then raise exception 'Horizonte máximo de 730 dias'; end if;
 return query
 with days as(select generate_series(start_on,end_on,'1 day')::date d),
 acc as(select * from accounts where owner_id=auth.uid() and (account_ids is null or id=any(account_ids))),
 events as(
 select case when t.status='confirmed' then coalesce(t.paid_on,t.occurred_on) else t.occurred_on end d,t.status,sum(case when t.kind='income' then t.amount_cents else -t.amount_cents end) amount from transactions t join acc a on a.id=t.account_id where t.deleted_at is null and t.payment_method<>'credit' group by case when t.status='confirmed' then coalesce(t.paid_on,t.occurred_on) else t.occurred_on end,t.status
 union all select case when t.status='confirmed' then coalesce(t.paid_on,t.occurred_on) else t.occurred_on end,t.status,t.amount_cents from transactions t join acc a on a.id=t.destination_account_id where t.deleted_at is null and t.kind='transfer'
 union all select p.paid_on,'confirmed',-p.amount_cents from payments p join acc a on a.id=p.account_id where p.reversed_at is null
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


create or replace function public.get_account_balances() returns table(account_id uuid,balance_cents bigint) language sql security invoker set search_path=public,pg_temp as $$
 select a.id,(a.opening_balance_cents+
 coalesce((select sum(case when t.account_id=a.id then case when t.kind='income' then t.amount_cents else -t.amount_cents end else 0 end +case when t.destination_account_id=a.id then t.amount_cents else 0 end) from transactions t where t.owner_id=auth.uid() and t.deleted_at is null and t.status='confirmed' and t.payment_method<>'credit' and coalesce(t.paid_on,t.occurred_on)<=(now() at time zone 'America/Sao_Paulo')::date),0)
 -coalesce((select sum(p.amount_cents) from payments p where p.owner_id=auth.uid() and p.account_id=a.id and p.reversed_at is null and p.paid_on<=(now() at time zone 'America/Sao_Paulo')::date),0))::bigint
 from accounts a where a.owner_id=auth.uid();
$$;

create function public.manage_finance(action text,payload jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); old_request idempotency_keys%rowtype; pay payments%rowtype; inv invoices%rowtype;
 tx transactions%rowtype; source financial_import_records%rowtype; obj uuid; result jsonb; dt date;
 amount bigint; day1 int; day2 int; day_value int; rule_id uuid; rules uuid[]; cash uuid; source_kind text; new_rules uuid[]; rule_index int;
begin
 if u is null or request_key is null then raise exception 'Acesso ou chave inválidos'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into old_request from idempotency_keys where owner_id=u and key=request_key;
 if found then
  if old_request.operation<>action or old_request.request_json<>payload then raise exception 'Chave reutilizada'; end if;
  return old_request.result_json;
 end if;
 obj:=(manage_finance.payload->>'id')::uuid;
 if action='reverse_payment' then
  select * into pay from payments where id=obj and owner_id=u for update;
  if not found or pay.reversed_at is not null then raise exception 'Pagamento não encontrado ou já desfeito'; end if;
  if pay.invoice_id is null then raise exception 'Quitação de plano exige um ajuste específico; este botão desfaz pagamentos de fatura.'; end if;
  if length(trim(coalesce(manage_finance.payload->>'reason','')))=0 then raise exception 'Informe o motivo'; end if;
  select * into inv from invoices where id=pay.invoice_id and owner_id=u for update;
  if inv.paid_cents<pay.amount_cents then raise exception 'Fatura inconsistente; concilie antes de desfazer'; end if;
  update payments set reversed_at=now(),reversal_reason=manage_finance.payload->>'reason' where id=obj;
  update invoices set paid_cents=paid_cents-pay.amount_cents,status=case when paid_cents-pay.amount_cents=0 then 'open' else 'partial' end where id=inv.id;
  update installments set status='open',settled_at=null where invoice_id=inv.id and status='paid';
  update installment_plans set status='open',version=version+1 where owner_id=u and status<>'settled' and id in(select plan_id from installments where invoice_id=inv.id);
 elsif action in ('confirm_transaction','unconfirm_transaction') then
  select * into tx from transactions where id=obj and owner_id=u and deleted_at is null for update;
  if not found or tx.version is distinct from (manage_finance.payload->>'version')::int then raise exception 'Movimento alterado; atualize a tela'; end if;
  if tx.payment_method='credit' then raise exception 'Pague ou desfaça pela fatura do cartão'; end if;
  if action='confirm_transaction' then
   if tx.status='confirmed' then raise exception 'Movimento já confirmado'; end if;
   dt:=(manage_finance.payload->>'paid_on')::date;
   if dt is null or dt>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data de pagamento inválida'; end if;
   update transactions set status='confirmed',paid_on=dt,version=version+1 where id=obj;
  else
   if tx.status<>'confirmed' then raise exception 'Movimento não está pago'; end if;
   if length(trim(coalesce(manage_finance.payload->>'reason','')))=0 then raise exception 'Informe o motivo'; end if;
   update transactions set status='scheduled',paid_on=null,version=version+1 where id=obj;
  end if;
 elsif action='link_loan_bank' then
  if manage_finance.payload->>'bank_code' not in ('Nubank','Santander','Itaú') then raise exception 'Banco inválido'; end if;
  update transactions set related_bank_code=manage_finance.payload->>'bank_code',version=version+1 where owner_id=u and id=obj and source_type='import_commitment';
  if not found then raise exception 'Compromisso não encontrado'; end if;
 elsif action='edit_imported_recurrence' then
  select * into source from financial_import_records where owner_id=u and id=obj and record_type='recurrence' for update;
  if not found or source.version is distinct from (manage_finance.payload->>'version')::int then raise exception 'Recorrência alterada; atualize a tela'; end if;
  amount:=(manage_finance.payload->>'amount_cents')::bigint;
  day1:=nullif(manage_finance.payload->>'day','')::int;day2:=nullif(manage_finance.payload->>'second_day','')::int;
  if amount is null or amount<=0 or amount>1000000000000 or length(trim(coalesce(manage_finance.payload->>'name','')))=0 or day1 not between 1 and 31 or day2 not between 1 and 31 or day1=day2 then raise exception 'Nome, valor ou dias inválidos'; end if;
  rules:=array(select jsonb_array_elements_text(coalesce(source.payload->'operational_rule_ids','[]')))::uuid[];
  -- Alterações só atingem regras futuras, preservando ocorrências já registradas.
  update recurrence_rules set active=false where owner_id=u and id=any(rules);
  new_rules:='{}';rule_index:=0;
  if source.payload->>'tipo'<>'assinatura_cartao' and day1 is not null and coalesce((manage_finance.payload->>'active')::boolean,true) then
   select id into cash from accounts where owner_id=u and bank_code='Santander' and active order by id limit 1;
   if cash is null then raise exception 'Cadastre Santander'; end if;
   source_kind:=case when source.payload->>'tipo'='receita' then 'income' else 'expense' end;
   foreach day_value in array array[day1,day2] loop
    rule_index:=rule_index+1;
    if day_value is not null then
     rule_id:=rules[rule_index];
     if rule_id is not null then
      update recurrence_rules set description=manage_finance.payload->>'name',amount_cents=amount,day=day_value,active=true where id=rule_id and owner_id=u;
      if not found then raise exception 'Regra vinculada n?o encontrada'; end if;
     else
     insert into recurrence_rules(owner_id,description,kind,amount_cents,account_id,day,start_on)
     values(u,manage_finance.payload->>'name',source_kind,amount,cash,day_value,coalesce(nullif(manage_finance.payload->>'start_on','')::date,(now() at time zone 'America/Sao_Paulo')::date)) returning id into rule_id;
     end if;
     new_rules:=array_append(new_rules,rule_id);
    end if;
   end loop;
  end if;
  if day1 is null or not coalesce((manage_finance.payload->>'active')::boolean,true) then new_rules:=rules; end if;
  update financial_import_records set payload=source.payload||jsonb_build_object('descricao',manage_finance.payload->>'name','valor_centavos',amount,'dia_mes',day1,'segundo_dia',day2,'status',case when coalesce((manage_finance.payload->>'active')::boolean,true) then 'ativa' else 'pausada' end,'operational_rule_ids',to_jsonb(new_rules)),version=version+1,needs_review=(day1 is null),review_reason=case when source.payload->>'tipo'='assinatura_cartao' then 'Componente da fatura, sem débito bancário separado.' when day1 is null then 'Informe o dia para gerar ocorrências.' else 'Regra editada; gere as próximas ocorrências. As existentes foram preservadas.' end where id=obj;
 else raise exception 'Ação desconhecida'; end if;
 insert into audit_events(owner_id,entity_type,entity_id,action,after_json) values(u,'finance_action',obj,action,payload);
 result:=jsonb_build_object('id',obj,'ok',true);
 insert into idempotency_keys(owner_id,key,operation,request_json,result_json) values(u,request_key,action,payload,result);
 return result;
end $$;
revoke all on function public.manage_finance(text,jsonb,uuid) from public,anon;
grant execute on function public.manage_finance(text,jsonb,uuid) to authenticated;

DO $fix$ declare definition text; begin
 definition:=pg_get_functiondef('public.command(text,jsonb,uuid)'::regprocedure);
 if position('rule_id=rr.id and occurrence_date=dt' in definition)>0 then
  definition:=replace(definition,'rule_id=rr.id and occurrence_date=dt',
   'rule_id=rr.id and extract(year from occurrence_date)=extract(year from dt) and extract(month from occurrence_date)=extract(month from dt)');
  execute definition;
 end if;
end $fix$;
commit;
