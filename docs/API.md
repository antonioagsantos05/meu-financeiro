# Contrato de operações v1

O navegador usa Supabase com JWT do titular. Todas as tabelas possuem RLS e escrita direta revogada; não há proxy obrigatório.

## command(operation, payload, request_key)

RPC POST /rest/v1/rpc/command. Retorna `{id,ok:true}`. Falhas abortam a transação. A mesma chave UUID e corpo retornam o resultado anterior; reutilização com outro corpo falha. Comandos por titular são serializados por advisory transaction lock. FKs compostas validam owner_id das referências.

| Operação | Campos |
| --- | --- |
| save_account | id/version ao editar; name, bank_code, opening_balance_cents, overdraft_limit_cents |
| save_card | name, account_id opcional, closing_day, due_day |
| save_tag / delete_tag | name; id para editar/excluir |
| create_transaction / update_transaction | id/version ao editar; kind, description, amount_cents, occurred_on, status, payment_method, account_id ou card_id, destination_account_id para transferência, tag_ids[], installment_count para crédito |
| delete_transaction | id, version, reason |
| pay_invoice | id da fatura, account_id, amount_cents, paid_on |
| settle_installment_plan | id do plano, version, account_id, amount_cents, paid_on, issuer_confirmed=true |
| save_recurrence | id opcional; description, amount_cents, day, end_on opcional, active na edição; kind/account_id/start_on na criação |
| toggle_recurrence | id |
| generate_recurrences | start_on, end_on; máximo 730 dias |
| save_reminder | id opcional, title, local_time, weekdays ISO 1–7, enabled na edição |
| delete_reminder | id |
| mark_daily_review | had_spending; data determinada no servidor |

kind: income/expense/transfer. status: confirmed/scheduled/estimated. payment_method: pix/debit/credit/transfer. Datas civis ISO; valores em centavos inteiros. Criação de compra gera parcelas atomicamente. Transferência usa um registro com duas contas e efeito consolidado neutro.

## Leitura

get_account_balances() retorna account_id/balance_cents. get_forecast(start_on,end_on,account_ids?,scenario_cents=0) retorna day/real_cents/projected_cents. Respeitam RLS. Recorrências precisam ser geradas explicitamente por horizonte.

## Push

save_push_subscription(subscription) recebe JSON padrão PushSubscription e valida endpoint HTTPS suportado. revoke_push_subscriptions() revoga todos os dispositivos do titular. A função de envio exige CRON_SECRET, nunca chamado pelo frontend.

## Tipos

As interfaces de domínio estão em src/domain/types.ts. Os tipos gerados específicos e o OpenAPI PostgREST devem ser exportados do projeto Supabase depois de provisionado. Não há projeto real para gerar esses artefatos nesta entrega.
