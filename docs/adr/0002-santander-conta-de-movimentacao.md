# Santander como conta de movimentação

Decisão informada pelo titular em 03/11/2026: contas Nubank e Itaú ficam zeradas; PIX e débito são feitos apenas pela conta Santander.

A aplicação passa a selecionar Santander nos movimentos de conta. Nubank e Itaú continuam disponíveis para identificação dos cartões pelo nome. A conta vinculada ao cartão representa a origem prevista do pagamento, não o banco emissor do cartão: pode ser Santander para um cartão Nubank ou Itaú.

Para manter Nubank/Itaú zerados, novas entradas/saídas, recorrências bancárias, transferências e pagamentos de fatura/quitação também exigem Santander. Compras no crédito continuam usando o cartão escolhido, sem baixar a conta imediatamente. Novas contas Nubank/Itaú só aceitam abertura/limite de conta zero.

Registros existentes não são excluídos nem zerados. Caso haja histórico em outra conta, ele continua compondo o saldo e precisa de correção explícita do titular; a interface não mascara os saldos. A migração somente instala validações para novas gravações, preservando metadados de movimentos legados.

Banco já instalado: executar somente `supabase/migrations/202611030003_santander_cash_account.sql` no SQL Editor. Não reexecutar `supabase/setup.sql`. A migração ainda precisa ser aplicada no projeto real.

Esta decisão substitui o exemplo original AC-01 de PIX no Nubank. O cenário passa a validar PIX no Santander sem alterar Nubank/Itaú. Não há alteração das regras de centavos, auditoria ou parcelamento.
