begin;
alter table public.invoices add column version int not null default 1;
alter table public.invoices add column label text;
alter table public.invoices add column manual_adjustment_cents bigint not null default 0;
alter table public.payments add column version int not null default 1;
alter table public.payments add column label text;

create function public.edit_financial_event(entity text,entity_id uuid,patch jsonb,expected_version int,request_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); previous idempotency_keys%rowtype; inv invoices%rowtype; pay payments%rowtype;
 tx transactions%rowtype; src financial_import_records%rowtype; amount bigint; dt date; obj uuid; result jsonb;
 signature text; tag_list uuid[]; delta bigint; new_paid bigint;
begin
 if u is null or request_key is null then raise exception 'Acesso ou chave inválidos'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 signature:='edit_'||entity;
 select * into previous from idempotency_keys where owner_id=u and key=request_key;
 if found then
  if previous.operation<>signature or previous.request_json<>jsonb_build_object('id',entity_id,'patch',patch,'version',expected_version) then raise exception 'Chave reutilizada'; end if;
  return previous.result_json;
 end if;
 amount:=(patch->>'amount_cents')::bigint;dt:=(patch->>'date')::date;
 if amount is null or amount<=0 or amount>1000000000000 or dt is null or length(trim(coalesce(patch->>'name','')))=0 then raise exception 'Nome, valor e data são obrigatórios'; end if;
 if entity='invoice' then
  select * into inv from invoices where id=entity_id and owner_id=u for update;
  if not found or inv.version is distinct from expected_version then raise exception 'Fatura alterada; atualize a tela'; end if;
  if amount<inv.paid_cents then raise exception 'Valor menor que o já pago. Edite ou desfaça o pagamento primeiro.'; end if;
  update invoices set label=trim(patch->>'name'),total_cents=amount,due_on=dt,
   manual_adjustment_cents=manual_adjustment_cents+(amount-inv.total_cents),version=version+1,
   status=case when paid_cents=amount then 'paid' when paid_cents>0 then 'partial' else 'open' end where id=entity_id;
 elsif entity='payment' then
  select * into pay from payments where id=entity_id and owner_id=u for update;
  if not found or pay.version is distinct from expected_version or pay.reversed_at is not null then raise exception 'Pagamento alterado ou desfeito'; end if;
  if dt>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Pagamento efetivo não pode estar no futuro'; end if;
  if pay.invoice_id is not null then
   select * into inv from invoices where id=pay.invoice_id and owner_id=u for update;
   new_paid:=inv.paid_cents-pay.amount_cents+amount;
   if new_paid>inv.total_cents then raise exception 'Pagamento excede o valor da fatura'; end if;
   update invoices set paid_cents=new_paid,version=version+1,status=case when new_paid=total_cents then 'paid' when new_paid>0 then 'partial' else 'open' end where id=inv.id;
   update installments set status=case when new_paid=inv.total_cents then 'paid' else 'open' end,settled_at=case when new_paid=inv.total_cents then now() else null end where invoice_id=inv.id and status in ('open','paid');
  end if;
  update payments set label=trim(patch->>'name'),amount_cents=amount,paid_on=dt,account_id=coalesce(nullif(patch->>'account_id','')::uuid,account_id),version=version+1 where id=entity_id;
 elsif entity='income_estimate' then
  select * into src from financial_import_records where id=entity_id and owner_id=u and record_type='income_pending' for update;
  if not found or src.version is distinct from expected_version then raise exception 'Entrada alterada; atualize a tela'; end if;
  if src.linked_id is null then
   select id into obj from accounts where owner_id=u and bank_code='Santander' and active order by id limit 1;
   if obj is null then raise exception 'Cadastre Santander'; end if;
   select id into obj from transactions where owner_id=u and kind='income' and amount_cents=amount and occurred_on=dt and deleted_at is null order by id limit 1;
   if obj is null then
   select id into obj from accounts where owner_id=u and bank_code='Santander' and active order by id limit 1;
   insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,source_type)
    values(u,'income',trim(patch->>'name'),amount,dt,'confirmed','pix',obj,'import_confirmed_income') returning id into obj;
   end if;
  else
   obj:=src.linked_id;
   update transactions set description=trim(patch->>'name'),amount_cents=amount,occurred_on=dt,paid_on=null,status='confirmed',version=version+1 where owner_id=u and id=obj and deleted_at is null;
   if not found then raise exception 'Entrada vinculada indisponível'; end if;
  end if;
  update financial_import_records set payload=src.payload||jsonb_build_object('descricao',patch->>'name','valor_centavos',amount,'data',dt,'data_confirmada',true,'status','confirmado'),linked_id=obj,linked_table='transactions',needs_review=false,review_reason='Informação confirmada pelo titular; saldo respeita a data do recebimento.',version=version+1 where id=entity_id;
 elsif entity='transaction' then
  select * into tx from transactions where id=entity_id and owner_id=u and deleted_at is null for update;
  if not found or tx.version is distinct from expected_version then raise exception 'Movimento alterado; atualize a tela'; end if;
  tag_list:=array(select jsonb_array_elements_text(coalesce(patch->'tag_ids','[]')))::uuid[];
  if exists(select 1 from unnest(tag_list) tag where not exists(select 1 from tags where id=tag and owner_id=u and deleted_at is null)) then raise exception 'Tag inválida'; end if;
  if tx.payment_method='credit' then
   if amount<>tx.amount_cents or dt<>tx.occurred_on or patch->>'payment_method'<>'credit' or (patch->>'card_id')::uuid is distinct from tx.card_id or (patch->>'installment_count')::int is distinct from (select installment_count from installment_plans where transaction_id=tx.id) then
    -- Parcelamento sem pagamentos continua usando a operação atômica original.
    perform command('update_transaction',patch||jsonb_build_object('id',tx.id,'version',tx.version,'description',patch->>'name','occurred_on',dt,'status','confirmed'),md5(request_key::text||'credit')::uuid);
   else
    update transactions set description=trim(patch->>'name'),tag_ids=tag_list,version=version+1 where id=entity_id;
   end if;
  else
   if patch->>'payment_method'='credit' then
    perform command('update_transaction',patch||jsonb_build_object('id',tx.id,'version',tx.version,'description',patch->>'name','occurred_on',dt,'status','confirmed'),md5(request_key::text||'credit')::uuid);
   else
    update transactions set description=trim(patch->>'name'),amount_cents=amount,occurred_on=dt,
     paid_on=case when tx.paid_on is not null then dt else null end,kind=patch->>'kind',
     payment_method=patch->>'payment_method',account_id=(patch->>'account_id')::uuid,
     destination_account_id=nullif(patch->>'destination_account_id','')::uuid,tag_ids=tag_list,status='confirmed',version=version+1 where id=entity_id;
   end if;
  end if;
 else raise exception 'Tipo de registro inválido'; end if;
 insert into audit_events(owner_id,entity_type,entity_id,action,before_json,after_json)
 values(u,entity,entity_id,'edit_with_correction',case entity when 'invoice' then to_jsonb(inv) when 'payment' then to_jsonb(pay) when 'transaction' then to_jsonb(tx) else to_jsonb(src) end,patch);
 result:=jsonb_build_object('id',entity_id,'ok',true);
 insert into idempotency_keys(owner_id,key,operation,request_json,result_json) values(u,request_key,signature,jsonb_build_object('id',entity_id,'patch',patch,'version',expected_version),result);
 return result;
end $$;
revoke all on function public.edit_financial_event(text,uuid,jsonb,int,uuid) from public,anon;
grant execute on function public.edit_financial_event(text,uuid,jsonb,int,uuid) to authenticated;
DO $adjust$ declare definition text; begin
 definition:=pg_get_functiondef('public.manage_finance(text,jsonb,uuid)'::regprocedure);
 definition:=replace(definition,
  'if tx.status=''confirmed'' then raise exception ''Movimento já confirmado'';',
  'if tx.status=''confirmed'' and coalesce(tx.paid_on,tx.occurred_on)<=(now() at time zone ''America/Sao_Paulo'')::date then raise exception ''Movimento já confirmado'';');
 execute definition;
end $adjust$;
commit;
