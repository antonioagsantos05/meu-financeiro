begin;
-- Ausência de fechamento é informação desconhecida, não dia inventado.
alter table public.cards alter column closing_day drop not null;
alter table public.cards add column if not exists issuer_bank_code text;
alter table public.invoices alter column closing_on drop not null;
alter table public.invoices add column if not exists source_type text not null default 'purchase';

create table public.financial_imports(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users,
 package_key text not null, payload jsonb not null, confirmed_balance_cents bigint,
 result_json jsonb, created_at timestamptz not null default now(), unique(owner_id,package_key)
);
create table public.financial_import_records(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users,
 import_id uuid not null references financial_imports, source_key text not null,
 record_type text not null, payload jsonb not null, needs_review boolean not null default false,
 review_reason text, linked_table text, linked_id uuid, unique(import_id,record_type,source_key)
);
alter table public.financial_imports enable row level security;
alter table public.financial_import_records enable row level security;
create policy owner_read on public.financial_imports for select to authenticated using(owner_id=auth.uid());
create policy owner_read on public.financial_import_records for select to authenticated using(owner_id=auth.uid());
revoke all on public.financial_imports,public.financial_import_records from public,anon,authenticated;
grant select on public.financial_imports,public.financial_import_records to authenticated;

-- Novas compras exigem fechamento conhecido; faturas agregadas importadas não.
create function public.require_known_card_cycle() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.payment_method='credit' and exists(select 1 from cards where id=new.card_id and owner_id=new.owner_id and closing_day is null) then
  raise exception 'Informe o fechamento do cartão antes de registrar novas compras. Faturas importadas continuam preservadas.';
 end if;
 return new;
end $$;
revoke all on function public.require_known_card_cycle() from public,anon,authenticated;
create trigger require_card_cycle before insert or update on public.transactions for each row execute function public.require_known_card_cycle();

create function public.import_financial_package(package jsonb,package_key text,confirmed_balance_cents bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 u uuid:=auth.uid(); batch financial_imports%rowtype; batch_id uuid; cash_id uuid; obj uuid;
 item jsonb; bank text; matches int; card_map jsonb:='{}'; card_id_value uuid;
 due date; closing date; cycle_key text; card_row cards%rowtype; existing invoices%rowtype;
 review boolean; reason text; target_table text; amount bigint; count_active int:=0; count_pending int:=0;
begin
 if u is null then raise exception 'Acesso não autorizado'; end if;
 if package_key is null or length(package_key) not between 1 and 100 or package->'metadados'->>'versao' is distinct from '1.0'
  or jsonb_typeof(package->'compromissos') is distinct from 'array'
  or jsonb_typeof(package->'cartoes') is distinct from 'array'
  or jsonb_typeof(package->'recorrencias') is distinct from 'array' then raise exception 'Formato do pacote inválido'; end if;
 if confirmed_balance_cents is not null and abs(confirmed_balance_cents)>1000000000000 then raise exception 'Saldo fora do limite'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into batch from financial_imports f where f.owner_id=u and f.package_key=import_financial_package.package_key;
 if found then
  if batch.payload<>package or batch.confirmed_balance_cents is distinct from import_financial_package.confirmed_balance_cents then raise exception 'Pacote já importado com outros dados; não será sobrescrito'; end if;
  return batch.result_json;
 end if;
 insert into financial_imports(owner_id,package_key,payload,confirmed_balance_cents)
 values(u,package_key,package,confirmed_balance_cents) returning id into batch_id;

 -- Reutiliza contas existentes. Não sobrescreve movimentações nem saldos reais.
 for item in select * from jsonb_array_elements(package->'contas') loop
  bank:=item->>'nome';
  if bank not in ('Nubank','Santander','Itaú') then raise exception 'Banco desconhecido'; end if;
  select count(*) into matches from accounts where owner_id=u and bank_code=bank and active;
  if matches>1 then raise exception 'Há mais de uma conta ativa para %. Selecione/concilie a conta antes de importar.',bank; end if;
  select id into obj from accounts where owner_id=u and bank_code=bank and active;
  review:=false; reason:=null;
  if obj is null then
   insert into accounts(owner_id,name,bank_code,opening_balance_cents)
    values(u,bank,bank,case when bank='Santander' then coalesce(confirmed_balance_cents,0) else 0 end) returning id into obj;
  elsif bank='Santander' and confirmed_balance_cents is not null then
   if not exists(select 1 from transactions where owner_id=u and (account_id=obj or destination_account_id=obj)) and not exists(select 1 from payments where owner_id=u and account_id=obj) then
    update accounts set opening_balance_cents=confirmed_balance_cents,version=version+1 where id=obj and opening_balance_cents<>confirmed_balance_cents;
   elsif not exists(select 1 from get_account_balances() b where b.account_id=obj and b.balance_cents=confirmed_balance_cents) then
    review:=true; reason:='Saldo Santander confirmado, mas há movimentações existentes: conciliar sem alterar histórico.';
   end if;
  end if;
  if bank='Santander' then cash_id:=obj; if confirmed_balance_cents is null then review:=true;reason:='Saldo inicial Santander ainda não confirmado; zero é provisório.'; end if; end if;
  insert into financial_import_records(owner_id,import_id,source_key,record_type,payload,needs_review,review_reason,linked_table,linked_id)
   values(u,batch_id,item->>'id','account',item,review,reason,'accounts',obj);
 end loop;
 if cash_id is null then raise exception 'Conta Santander ausente no pacote'; end if;

 for item in select * from jsonb_array_elements(package->'cartoes') loop
  bank:=case item->>'id' when 'cartao_nubank' then 'Nubank' when 'cartao_santander' then 'Santander' when 'cartao_itau' then 'Itaú' end;
  if bank is null then raise exception 'Cartão desconhecido'; end if;
  select count(*) into matches from cards where owner_id=u and active and (issuer_bank_code=bank or position(lower(bank) in lower(name))>0);
  if matches>1 then raise exception 'Mais de um cartão % encontrado; concilie antes de importar.',bank; end if;
  select id into obj from cards where owner_id=u and active and (issuer_bank_code=bank or position(lower(bank) in lower(name))>0);
  review:=false;reason:=null;
  if obj is null then
   insert into cards(owner_id,name,issuer_bank_code,account_id,closing_day,due_day)
    values(u,bank,bank,cash_id,nullif(item->>'fechamento_dia','')::int,(item->>'vencimento_dia')::int) returning id into obj;
  else
   select * into card_row from cards where id=obj;
   if card_row.due_day<>(item->>'vencimento_dia')::int or (nullif(item->>'fechamento_dia','') is not null and card_row.closing_day is distinct from (item->>'fechamento_dia')::int) then
    review:=true;reason:='Ciclo cadastrado difere do pacote; o cadastro existente foi preservado.';
   end if;
   -- Conta vinculada é a origem prevista do pagamento, não o emissor.
   update cards set account_id=cash_id,issuer_bank_code=coalesce(issuer_bank_code,bank)
    where id=obj and (account_id is distinct from cash_id or issuer_bank_code is null);
  end if;
  card_map:=card_map||jsonb_build_object(item->>'id',obj);
  if nullif(item->>'fechamento_dia','') is null then review:=true; reason:=coalesce(reason||' ','')||'Fechamento não informado; não foi inventado.'; end if;
  insert into financial_import_records(owner_id,import_id,source_key,record_type,payload,needs_review,review_reason,linked_table,linked_id)
   values(u,batch_id,item->>'id','card',item,review,reason,'cards',obj);
 end loop;

 for item in select * from jsonb_array_elements(package->'compromissos') loop
  amount:=(item->>'valor_centavos')::bigint;
  if amount is null or amount<=0 or amount>1000000000000 then raise exception 'Valor de compromisso inválido'; end if;
  due:=nullif(item->>'data_vencimento','')::date;obj:=null;target_table:=null;review:=false;reason:=null;
  if item->>'id'='itau_2027-04-05' then
   review:=true;reason:='Possível duplicidade com cobrança Itaú de 03/04. Não somada às faturas/projeção até confirmar.';
  elsif item->>'tipo'='fatura' then
   card_id_value:=(card_map->>(item->>'cartao_id'))::uuid;
   if card_id_value is null or due is null then raise exception 'Fatura sem cartão ou data'; end if;
   select * into card_row from cards where id=card_id_value;
   closing:=case when card_row.closing_day is not null then civil_day(due,card_row.closing_day) end;
   if closing>=due then closing:=civil_day((date_trunc('month',due)-interval '1 month')::date,card_row.closing_day); end if;
   cycle_key:=coalesce(to_char(closing,'YYYY-MM'),to_char(due,'YYYY-MM'));
   select count(*) into matches from invoices where owner_id=u and card_id=card_id_value and (due_on=due or period_key=cycle_key);
   if matches>1 then raise exception 'Faturas existentes ambíguas para %',item->>'id'; end if;
   select * into existing from invoices where owner_id=u and card_id=card_id_value and (due_on=due or period_key=cycle_key);
   if found then
    obj:=existing.id;
    if existing.total_cents<>amount or existing.due_on<>due then review:=true;reason:='Fatura existente tem outro valor/data. Não alterada nem duplicada; conciliar com o pacote.'; end if;
   else
    insert into invoices(owner_id,card_id,period_key,closing_on,due_on,total_cents,source_type)
     values(u,card_id_value,cycle_key,closing,due,amount,'import_aggregate') returning id into obj;
   end if;
   target_table:='invoices';
   if item->>'id'='santander_2026-12' then review:=true;reason:=coalesce(reason||' ','')||'Base da fatura importada. Acréscimo estimado de assinaturas mantido nos metadados, sem débito duplicado; conciliar.'; end if;
  elsif item->>'tipo' in ('emprestimo','despesa') then
   if due is null then review:=true;reason:='Sem data confirmada';
   else
    -- Sem identidade externa anterior não se presume que uma transação manual igual seja duplicata.
    if exists(select 1 from transactions where owner_id=u and deleted_at is null and kind='expense' and amount_cents=amount and occurred_on=due and account_id=cash_id) then
     review:=true;reason:='Existe despesa manual com mesmo valor/data; revisar antes de ativar o compromisso.';
    else
     insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,source_type)
      values(u,'expense',item->>'descricao',amount,due,'scheduled','pix',cash_id,'import_commitment') returning id into obj;
     target_table:='transactions';
    end if;
   end if;
  else raise exception 'Tipo de compromisso não suportado'; end if;
  if obj is not null then count_active:=count_active+1; end if;
  if review then count_pending:=count_pending+1; end if;
  insert into financial_import_records(owner_id,import_id,source_key,record_type,payload,needs_review,review_reason,linked_table,linked_id)
   values(u,batch_id,item->>'id','commitment',item,review,reason,target_table,obj);
 end loop;

 -- Assinaturas são componentes de faturas; salário/psicóloga não possuem dia confirmado.
 for item in select * from jsonb_array_elements(package->'recorrencias') loop
  if (item->>'valor_centavos')::bigint<=0 then raise exception 'Recorrência com valor inválido'; end if;
  reason:=case when item->>'tipo'='assinatura_cartao' then 'Componente da fatura Santander. Sem débito bancário separado e sem geração adicional sobre faturas agregadas.' else 'Dia não confirmado; recorrência preservada sem gerar datas fictícias.' end;
  insert into financial_import_records(owner_id,import_id,source_key,record_type,payload,needs_review,review_reason)
   values(u,batch_id,item->>'id','recurrence',item,item->>'tipo'<>'assinatura_cartao',reason);
 end loop;
 for item in select * from jsonb_array_elements(coalesce(package->'metadados'->'recebimentos_novembro','[]')) loop
  -- Datas do pacote são explicitamente não confirmadas; não viram entradas reais ou previstas datadas.
  insert into financial_import_records(owner_id,import_id,source_key,record_type,payload,needs_review,review_reason)
   values(u,batch_id,item->>'descricao','income_pending',item,true,'Valor/dia de recebimento precisam de confirmação; data sugerida preservada apenas como referência.');
 end loop;
 insert into financial_import_records(owner_id,import_id,source_key,record_type,payload,needs_review,review_reason)
  values(u,batch_id,'metadados','metadata',package->'metadados',true,'Cenário ilustrativo preservado separado da projeção operacional: exclui salário de dezembro, inclui valores estimados e sessões sem dia definido.');
 insert into audit_events(owner_id,entity_type,entity_id,action,after_json)
  values(u,'financial_imports',batch_id,'import_package',jsonb_build_object('package_key',package_key,'activated_commitments',count_active,'pending_commitments',count_pending,'confirmed_santander_balance_cents',confirmed_balance_cents));
 batch.result_json:=jsonb_build_object('id',batch_id,'activated_commitments',count_active,'pending_commitments',count_pending,'ok',true);
 update financial_imports set result_json=batch.result_json where id=batch_id;
 return batch.result_json;
end $$;
revoke all on function public.import_financial_package(jsonb,text,bigint) from public,anon;
grant execute on function public.import_financial_package(jsonb,text,bigint) to authenticated;
commit;
