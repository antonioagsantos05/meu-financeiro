begin;
alter table public.recurrence_rules add column tag_ids uuid[] not null default '{}';

-- Persiste tags no mesmo comando transacional e as copia para ocorrências.
DO $patch$ declare definition text; begin
 definition:=pg_get_functiondef('public.command(text,jsonb,uuid)'::regprocedure);
 definition:=replace(definition,
  'insert into recurrence_rules(owner_id,description,kind,amount_cents,account_id,day,start_on,end_on) values(u,payload->>''description'',payload->>''kind'',(payload->>''amount_cents'')::bigint,(payload->>''account_id'')::uuid,(payload->>''day'')::int,(payload->>''start_on'')::date,nullif(payload->>''end_on'','''')::date)',
  'insert into recurrence_rules(owner_id,description,kind,amount_cents,account_id,day,start_on,end_on,tag_ids) values(u,payload->>''description'',payload->>''kind'',(payload->>''amount_cents'')::bigint,(payload->>''account_id'')::uuid,(payload->>''day'')::int,(payload->>''start_on'')::date,nullif(payload->>''end_on'','''')::date,array(select jsonb_array_elements_text(coalesce(payload->''tag_ids'',''[]'')))::uuid[])');
 definition:=replace(definition,
  'update recurrence_rules set description=payload->>''description'',amount_cents=',
  'update recurrence_rules set tag_ids=array(select jsonb_array_elements_text(coalesce(payload->''tag_ids'',''[]'')))::uuid[],description=payload->>''description'',amount_cents=');
 definition:=replace(definition,
  'insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,source_type) values(u,rr.kind,rr.description,rr.amount_cents,dt,''estimated'',''pix'',rr.account_id,''recurrence'')',
  'insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,source_type,tag_ids) values(u,rr.kind,rr.description,rr.amount_cents,dt,''scheduled'',''pix'',rr.account_id,''recurrence'',rr.tag_ids)');
 execute definition;
end $patch$;

create function public.validate_recurrence_tags() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if exists(select 1 from unnest(new.tag_ids) tag where not exists(select 1 from tags where id=tag and owner_id=new.owner_id and deleted_at is null)) then raise exception 'Tag de recorrência inválida'; end if;
 return new;
end $$;
revoke all on function public.validate_recurrence_tags() from public,anon,authenticated;
create trigger recurrence_tags before insert or update on public.recurrence_rules for each row execute function public.validate_recurrence_tags();

-- A edição importada já é protegida por titular/versão/lock/idempotência.
-- Acrescenta tags e intervalo sem alterar parcelas/ocorrências já existentes.
DO $patch$ declare definition text; begin
 definition:=pg_get_functiondef('public.manage_finance(text,jsonb,uuid)'::regprocedure);
 definition:=replace(definition,
  '  update financial_import_records set payload=source.payload||jsonb_build_object(',
  '  if exists(select 1 from jsonb_array_elements_text(coalesce(manage_finance.payload->''tag_ids'',''[]'')) tag where not exists(select 1 from tags where id=tag::uuid and owner_id=u and deleted_at is null)) then raise exception ''Tag inválida''; end if;
  update recurrence_rules set tag_ids=array(select jsonb_array_elements_text(coalesce(manage_finance.payload->''tag_ids'',''[]'')))::uuid[],end_on=nullif(manage_finance.payload->>''end_on'','''')::date where owner_id=u and id=any(new_rules);
  update financial_import_records set payload=source.payload||jsonb_build_object(''tag_ids'',coalesce(manage_finance.payload->''tag_ids'',''[]''),''end_on'',manage_finance.payload->>''end_on'',''confirmed_dates'',coalesce(manage_finance.payload->''dates'',source.payload->''confirmed_dates''))||jsonb_build_object(');
 definition:=replace(definition,' else raise exception ''A??o desconhecida''; end if;',
 ' if manage_finance.payload ? ''dates'' then perform schedule_imported_sessions(obj,array(select jsonb_array_elements_text(manage_finance.payload->''dates''))::date[]); end if;
 else raise exception ''A??o desconhecida''; end if;');
 execute definition;
end $patch$;

create function public.prepare_financial_horizon(start_on date,end_on date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); r financial_import_records%rowtype; existing transactions%rowtype;
 cash uuid; target uuid; amount bigint; due date; matches int; result jsonb;
begin
 if u is null then raise exception 'Acesso não autorizado'; end if;
 if start_on is null or end_on is null or end_on-start_on not between 0 and 730 then raise exception 'Período inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select id into cash from accounts where owner_id=u and bank_code='Santander' and active order by id limit 1;
 -- Reconciliar compromissos datados do pacote: respeita pagamento existente e evita duplicata.
 if cash is not null then
  for r in select * from financial_import_records where owner_id=u and record_type='commitment' and payload->>'tipo'='despesa' and payload->>'data_vencimento' is not null loop
   due:=(r.payload->>'data_vencimento')::date;amount:=(r.payload->>'valor_centavos')::bigint;
   if due not between start_on and end_on then continue; end if;
   if r.linked_id is not null then
    select * into existing from transactions where owner_id=u and id=r.linked_id;
    if found then continue; end if;
   end if;
   select count(*) into matches from transactions where owner_id=u and deleted_at is null and kind='expense' and amount_cents=amount and occurred_on=due and lower(trim(description))=lower(trim(r.payload->>'descricao'));
   if matches>1 then continue; end if;
   select id into target from transactions where owner_id=u and deleted_at is null and kind='expense' and amount_cents=amount and occurred_on=due and lower(trim(description))=lower(trim(r.payload->>'descricao'));
   if target is null then
    insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,source_type)
    values(u,'expense',r.payload->>'descricao',amount,due,'scheduled','pix',cash,'import_commitment') returning id into target;
   end if;
   update financial_import_records set linked_table='transactions',linked_id=target,needs_review=false,review_reason='Compromisso datado vinculado ao planejamento.',version=version+1 where id=r.id;
   insert into audit_events(owner_id,entity_type,entity_id,action,after_json) values(u,'financial_import_records',r.id,'reconcile_dated_commitment',jsonb_build_object('transaction_id',target));
  end loop;
 end if;
 result:=command('generate_recurrences',jsonb_build_object('start_on',start_on,'end_on',end_on),md5(u::text||start_on::text||end_on::text||(select coalesce(jsonb_agg(to_jsonb(rr) order by rr.id),'[]'::jsonb)::text from recurrence_rules rr where rr.owner_id=u))::uuid);
 return result;
end $$;
revoke all on function public.prepare_financial_horizon(date,date) from public,anon;
grant execute on function public.prepare_financial_horizon(date,date) to authenticated;
create function public.schedule_imported_sessions(source_id uuid,dates date[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); src financial_import_records%rowtype; child financial_import_records%rowtype;
 requested_dates date[]:=dates; day_value date; account uuid; target uuid; amount bigint; tags_value uuid[]; key_value text; tx transactions%rowtype;
begin
 if u is null or dates is null or cardinality(dates)>100 or array_position(dates,null) is not null then raise exception 'Datas inválidas'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into src from financial_import_records where id=source_id and owner_id=u and record_type='recurrence' for update;
 if not found or src.payload->>'tipo'<>'despesa' then raise exception 'Recorrência de sessões não encontrada'; end if;
 amount:=(src.payload->>'valor_centavos')::bigint;
 if amount is null or amount<=0 or amount>1000000000000 then raise exception 'Valor de sessão inválido'; end if;
 tags_value:=array(select jsonb_array_elements_text(coalesce(src.payload->'tag_ids','[]')))::uuid[];
 if exists(select 1 from unnest(tags_value) tag where not exists(select 1 from tags where id=tag and owner_id=u and deleted_at is null)) then raise exception 'Tag inválida'; end if;
 select id into account from accounts where owner_id=u and bank_code='Santander' and active order by id limit 1;
 if account is null then raise exception 'Cadastre Santander'; end if;
 for child in select * from financial_import_records where owner_id=u and import_id=src.import_id and record_type='recurrence_session' and payload->>'recurrence_id'=src.id::text loop
  if not ((child.payload->>'date')::date=any(dates)) then
   update transactions set deleted_at=now(),version=version+1 where id=child.linked_id and owner_id=u and status<>'confirmed' and deleted_at is null;
  end if;
 end loop;
 foreach day_value in array dates loop
  key_value:=src.source_key||':'||day_value::text;
  select * into child from financial_import_records where import_id=src.import_id and owner_id=u and record_type='recurrence_session' and source_key=key_value;
  target:=child.linked_id;
  if target is null then
   insert into transactions(owner_id,kind,description,amount_cents,occurred_on,status,payment_method,account_id,source_type,tag_ids)
    values(u,'expense',src.payload->>'descricao',amount,day_value,'scheduled','pix',account,'recurrence_session',tags_value) returning id into target;
   insert into financial_import_records(owner_id,import_id,source_key,record_type,payload,linked_table,linked_id)
    values(u,src.import_id,key_value,'recurrence_session',jsonb_build_object('recurrence_id',src.id,'date',day_value,'valor_centavos',amount),'transactions',target);
  else
   update transactions set description=src.payload->>'descricao',tag_ids=tags_value,
    amount_cents=case when status='confirmed' then amount_cents else amount end,
    deleted_at=case when status='confirmed' then deleted_at else null end,version=version+1 where owner_id=u and id=target;
  end if;
 end loop;
 update financial_import_records set payload=src.payload||jsonb_build_object('observacao','Datas de sessoes definidas pelo titular; PIX Santander.','confirmed_dates',to_jsonb(requested_dates),'payment_method','pix','account_id',account),needs_review=false,review_reason='Sessões datadas via PIX do Santander.',version=version+1 where id=src.id;
 insert into audit_events(owner_id,entity_type,entity_id,action,after_json) values(u,'financial_import_records',src.id,'schedule_sessions',jsonb_build_object('dates',dates,'amount_cents',amount,'tag_ids',tags_value));
 return jsonb_build_object('ok',true,'sessions',cardinality(dates));
end $$;
revoke all on function public.schedule_imported_sessions(uuid,date[]) from public,anon;
grant execute on function public.schedule_imported_sessions(uuid,date[]) to authenticated;
commit;
