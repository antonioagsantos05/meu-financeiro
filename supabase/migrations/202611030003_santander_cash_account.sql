-- Regra informada pelo titular: Nubank/Itaú sem saldo bancário;
-- movimentações de conta e pagamentos usam Santander. Não altera histórico.
begin;

create function public.enforce_santander_cash() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare account_uuid uuid; destination_uuid uuid;
begin
 if tg_table_name='accounts' then
  if tg_op='UPDATE' then
   if new.bank_code=old.bank_code and new.opening_balance_cents=old.opening_balance_cents and new.overdraft_limit_cents=old.overdraft_limit_cents then return new; end if;
  end if;
  if new.bank_code<>'Santander' and (new.opening_balance_cents<>0 or new.overdraft_limit_cents<>0) then
   raise exception 'Nubank e Itaú ficam com saldo bancário e limite de conta zerados. Use a conta Santander para movimentar dinheiro.';
  end if;
  return new;
 elsif tg_table_name='transactions' then
  if tg_op='UPDATE' then
   if new.account_id is not distinct from old.account_id and new.destination_account_id is not distinct from old.destination_account_id and new.payment_method=old.payment_method and new.amount_cents=old.amount_cents and new.kind=old.kind and new.status=old.status and new.occurred_on=old.occurred_on then return new; end if;
  end if;
  if new.payment_method='credit' then return new; end if;
  account_uuid:=new.account_id;
  destination_uuid:=new.destination_account_id;
 elsif tg_table_name='payments' then
  account_uuid:=new.account_id;
 elsif tg_table_name='recurrence_rules' then
  if tg_op='UPDATE' and new.account_id is not distinct from old.account_id and not new.active then return new; end if;
  account_uuid:=new.account_id;
 elsif tg_table_name='cards' then
  account_uuid:=new.account_id;
  if account_uuid is null then return new; end if;
 end if;
 if not exists(select 1 from accounts where id=account_uuid and owner_id=new.owner_id and bank_code='Santander' and active) then
  raise exception 'PIX, débito e movimentações bancárias usam somente uma conta Santander ativa.';
 end if;
 if destination_uuid is not null and not exists(select 1 from accounts where id=destination_uuid and owner_id=new.owner_id and bank_code='Santander' and active) then
  raise exception 'Nubank e Itaú são usados apenas para cartões; não recebem transferências no aplicativo.';
 end if;
 return new;
end $$;

revoke all on function public.enforce_santander_cash() from public,anon,authenticated;
create trigger enforce_cash_account before insert or update on public.accounts for each row execute function public.enforce_santander_cash();
create trigger enforce_cash_transaction before insert or update on public.transactions for each row execute function public.enforce_santander_cash();
create trigger enforce_cash_payment before insert or update on public.payments for each row execute function public.enforce_santander_cash();
create trigger enforce_cash_recurrence before insert or update on public.recurrence_rules for each row execute function public.enforce_santander_cash();
create trigger enforce_cash_card before insert or update on public.cards for each row execute function public.enforce_santander_cash();

commit;
