# Gastos fixos, datas e tags recorrentes

Atualização solicitada pelo titular: psicóloga via PIX Santander, dentista visível em dezembro, relatório de gastos fixos, seleção de datas mais simples e tags nos recorrentes.

## Aplicação

No banco existente atualizado até 007, execute uma vez `private-imports/ATUALIZAR_FIXOS_E_DATAS.sql`. O arquivo instala a migração 008 e cadastra as datas confirmadas pelo titular. Não reexecute os scripts anteriores.

- Psicóloga: quatro sessões datadas explicitamente pelo titular. Não são geradas sessões indefinidas após o período informado. O método é PIX e a conta é Santander; cada sessão é uma saída prevista até seu pagamento.
- Dentista: o compromisso datado do pacote é reutilizado. A preparação do horizonte reconcilia compromissos datados pendentes sem duplicar os que já estão vinculados. O SQL pessoal restaura somente o dentista do titular caso tenha sido excluído e solicitado novamente.
- Ao abrir/recarregar dados, o aplicativo prepara as ocorrências do horizonte de 90 dias. Reprocessamento é idempotente; o mesmo horizonte com as mesmas regras reutiliza a solicitação de geração.
- Datas de sessões podem ser alteradas no editor da recorrência importada. Remover uma sessão cancela logicamente a ocorrência ainda não paga; pagamentos existentes são preservados. Dias pagos não são reescritos pelo agendamento.

## Relatórios

Gastos fixos mostram separadamente recorrências/parcelas pela conta e assinaturas componentes das faturas. O segundo grupo não é somado novamente ao caixa. Empréstimos, sessões datadas e recorrências são reconhecidos como fixos; movimentos bancários com tags Fixo/Fixos/Gastos fixos também podem ser classificados. Dentista avulso permanece nos gastos gerais, sem presumir uma recorrência.

## Datas

Movimentos e Relatórios possuem mês anterior, este mês, próximo mês, escolha direta de mês e intervalo personalizado. Datas inicial/final se ajustam para não produzir período invertido. O calendário permite trocar o mês diretamente, voltar para hoje e iniciar um lançamento com a data do dia selecionado.

## Tags

Tags são opcionais e podem ser criadas/selecionadas nas recorrências comuns e importadas. As tags da regra são copiadas para ocorrências novas. Tags de sessões são sincronizadas pelo agendamento, sem alterar os valores de sessões já pagas. Validação no banco impede tags de outro titular. Alterar uma regra não reescreve os lançamentos históricos já gerados.

Os dados pessoais e o SQL de datas do titular permanecem em private-imports/, ignorado pelo Git. A migração versionada é genérica e não contém os valores/dias pessoais.
