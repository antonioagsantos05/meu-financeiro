# Entradas previstas e formulário simples

O titular solicitou criação de tags no próprio Novo movimento e inclusão dos recebimentos futuros na projeção. O formulário mantém Nome, valor, data, pagamento e tags em destaque; confirmação fica em Mais opções e a conta Santander é automática quando há somente uma opção.

As entradas importadas que possuem uma data sugerida no pacote passam a participar da projeção como estimativas nessa data, com aviso explícito. Isso modifica a política anterior de excluí-las completamente até confirmação. Nenhuma entrada é efetivada nem aumenta saldo real por essa mudança.

Informações sem dia algum continuam pendentes. O salário de dezembro continua excluído do cenário solicitado no pacote. O valor do 13º continua estimado. Não são inventadas datas para sessões de psicóloga.

A função get_forecast é atualizada por migração incremental. Não é necessário refazer a carga nem apagar registros. Tags novas são persistidas pelo comando autenticado existente e selecionadas no lançamento em edição sem fechar o formulário.
