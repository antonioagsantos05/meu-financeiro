# Atualização de movimentos, pagamentos, calendário e recorrências

## Aplicar no banco existente

Execute uma vez `private-imports/ATUALIZAR_FUNCIONALIDADES.sql` no SQL Editor e atualize a página do aplicativo. Esse arquivo contém a migração 202611030006 e o vínculo solicitado dos empréstimos importados ao Nubank, limitado ao titular da carga. Não reimporta o pacote, não apaga dados e não desfaz pagamentos sozinho.

Para aplicar somente a estrutura genérica com CLI/migrações, use `supabase/migrations/202611030006_payments_and_recurrences.sql`. O vínculo pessoal também pode ser feito na seção Empréstimos da interface. Não execute ambos como se fossem migrações diferentes.

## Comportamento

- Movimentos reúne lançamentos, pagamentos de fatura/quitação e saldos de faturas abertas. Pagamentos desfeitos continuam identificados no histórico. O período inicial é o mês inteiro; datas filtram a data efetiva para registros pagos.
- Pagar uma despesa ou receber uma receita preserva o vencimento original e registra a data efetiva. Desfazer devolve ao estado agendado e exige motivo.
- Desfazer pagamento de fatura marca o pagamento original como revertido, recalcula a fatura, reabre parcelas quando necessário e restaura o caixa. A operação é auditada, idempotente e serializada por titular. Quitação antecipada de plano não usa esse botão: exige política de ajuste específica.
- Relatórios usam o caixa: receitas/despesas efetivadas, pagamentos de fatura e quitação, além de previsões separadas. Compra no crédito não gera uma segunda saída no total. Tags usam a mesma base do realizado e há um grupo Sem tags para pagamentos sem classificação.
- O calendário mostra um mês por vez, com navegação e painel dos movimentos/saldo do dia escolhido. Datas sem projeção ficam desabilitadas; datas provisórias não são apresentadas como recebidas.
- Empréstimos aparecem em seção própria de Cartões, separados das faturas, com instituição e conta de pagamento distintas. Vincular ao Nubank não soma a parcela à fatura nem muda a conta de origem Santander.
- Recorrências importadas possuem edição de nome, valor, dias e estado ativo. Assinaturas continuam componentes de fatura: editar seu cadastro não soma automaticamente outro débito às faturas agregadas. Para receitas/despesas com dia definido, são criadas/atualizadas regras futuras; use Gerar previsões para materializá-las.
- Edições de regras não reescrevem ocorrências já registradas. A geração mensal foi ajustada para não duplicar a competência quando o dia é alterado. Regras internas vinculadas às recorrências importadas não aparecem duplicadas na lista principal.

## Validação

Testes cobrem reversão, idempotência, saldo/fatura, preservação de vencimento, edição de assinatura sem débito extra, reprocessamento mensal sem duplicata, composição dos relatórios e interação com o calendário. O SQL final pessoal foi executado somente em base PostgreSQL embarcada descartável, inclusive a associação de quatro parcelas. A aplicação no projeto Supabase continua sendo uma etapa externa.
