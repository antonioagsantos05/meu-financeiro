# Movimentos simples e edição auditada

O titular solicitou Entrada/Saída, remoção do registro de teste desfeito, ausência do seletor de confirmação e edição de todos os registros visíveis.

- Novo movimento usa Entrada, Saída e Transferência. O cadastro já é informação confirmada; não há seletor de status.
- Data futura continua sendo planejamento: não aumenta o saldo real antes dessa data. É possível registrar recebimento/pagamento efetivo antecipado pela ação correspondente.
- Movimentos desfeitos ficam fora da lista normal, preservados no banco, exportação e auditoria.
- Entradas importadas com data definida são confirmadas pelo SQL pessoal de atualização, vinculadas a um lançamento real datado, sem duplicação do item de origem. Isso aplica a confirmação atual do titular às informações antes tratadas como estimativas.
- Todas as linhas de Movimentos têm edição, inclusive faturas, pagamentos e entradas de origem importada. Os campos de fatura trabalham com o valor total, não apenas o saldo em aberto.
- Editar fatura recalcula o saldo e registra ajuste explícito. Não permite reduzir total abaixo do já pago sem corrigir o pagamento primeiro.
- Editar pagamento corrige a saída real e o acumulado pago da fatura. Um pagamento efetivo não aceita data futura. Pagamentos já desfeitos são preservados como histórico e não são editados na lista normal.
- Movimentos bancários confirmados podem ser corrigidos com versionamento e auditoria. Para compras no crédito, Nome/tags são editáveis mesmo após pagamento. Alterações financeiras no parcelamento continuam usando a operação atômica de parcelas, que bloqueia reescrita de parcelas pagas; correções nesses valores passam pelo ajuste da fatura/pagamento.

Banco já atualizado até a migração 006: executar uma vez `private-imports/SIMPLIFICAR_MOVIMENTOS.sql`. Ele instala a migração 007 e confirma as entradas datadas do pacote do titular. Não executar novamente setup.sql nem os antigos scripts de atualização. A interface pode ser recarregada com F5 após aplicar.
