# Revisão de regras de negócio — 03/11/2026

Atualização posterior à revisão: o titular definiu Santander como conta de movimentação e Nubank/Itaú apenas para cartões, com saldo bancário zero. Essa decisão substitui o exemplo AC-01 de PIX no Nubank. Ver `adr/0002-santander-conta-de-movimentacao.md` e migração 202611030003. Os demais achados abaixo permanecem como registro da revisão original.

## Resultado

A implementação atual **não atende integralmente** às especificações. Há regras centrais implementadas, mas também divergências reproduzidas e funcionalidades parciais. Login bem-sucedido e 17 testes passando não constituem aprovação de todos os critérios de aceite.

Fontes: os DOCX de negócio e técnico fornecidos pelo titular, extraídos em `especificacao-negocio.txt` e `especificacao-tecnica.txt`; implementação atual; correção posterior do titular para usar **Nome** no lançamento. Os documentos são requisitos para comparação, não autorização para inserir seus exemplos financeiros como fatos reais.

Esta revisão não modifica o banco de produção e não aplica correções financeiras. O ajuste visual Nome já está presente no formulário, sem campo adicional de descrição. Internamente, o contrato continua usando `description`; não é necessário alterar tabelas por causa do rótulo.

Legenda: **Implementado** = encontrado no código, sem implicar validação completa em produção; **Parcial** = há comportamento, mas faltam partes ou existem divergências; **Pendente externo** = depende de configuração/validação fora do código; **Decisão pendente** = documento ainda não define a política final.

## Achados prioritários

### A-01 — Alta: cadastro público continua habilitado

A consulta somente de leitura ao endpoint Auth do projeto configurado retornou `disable_signup: false`, em 03/11/2026. A aplicação não tem botão de cadastro, mas isso não desabilita o cadastro pela API. RLS continua isolando dados entre usuários; a divergência é a exigência de acesso pessoal sem signup público (RF-001).

Correção: desabilitar novos cadastros no Supabase Auth e confirmar o estado pela API. A criação administrativa do titular continua sendo o caminho previsto. Não foi tentado nenhum cadastro de teste em produção.

### A-02 — Alta: recorrência mensal pode duplicar após mudar o dia

Reproduzido em banco local descartável: gerar janeiro para dia 5, editar a regra para dia 10 e gerar janeiro novamente cria **05/01 e 10/01**, ambas na mesma competência. A proteção atual é por regra/data, não por regra/competência mensal.

Referência: `supabase/migrations/202611030001_initial.sql`, tabela `recurrence_occurrences` e operação `generate_recurrences`. Viola a unicidade mensal de RN-010. O contrato técnico sugeriu regra/data, mas a regra de negócio mensal precisa continuar satisfeita quando o dia muda.

Correção: chave de competência mensal independente do dia e política de edição das ocorrências já geradas. Antes de adicionar uma restrição, verificar e tratar possíveis duplicatas existentes sem apagar histórico.

### A-03 — Alta: relatórios misturam bases diferentes

Os cartões de receitas/despesas realizadas filtram `confirmed` e data até hoje. Os grupos por tag e pagamento somam **todos os status** no período. Exemplo: gasto confirmado de R$ 50 e estimado de R$ 100 na mesma tag exibem R$ 50 no total realizado e R$ 150 no grupo, sem distinguir as bases. As barras usam o realizado como denominador e truncam em 100%.

Referência: `src/App.tsx`, cálculo de `income`/`expense` e página Relatórios. RN-012/RN-015 e RF-020 ficam parcialmente atendidos. A ausência de duplicação por tags está implementada no total geral; o defeito aqui é consistência entre realizado e previsto.

Correção: apresentar realizado/agendado/estimado separadamente e aplicar a mesma base em totais, grupos e barras. O conceito de despesa de compra versus saída de caixa também deve estar explícito.

### A-04 — Média: editar o banco da conta não salva

O formulário permite selecionar outro banco, mas `save_account` atualiza apenas nome, saldo inicial, limite e versão. Reproduzido: enviar Itaú para uma conta Nubank mantém Nubank e retorna sucesso.

Correção: salvar a alteração com validação/auditoria ou bloquear o campo na edição com justificativa visível. Não retornar sucesso silencioso para uma alteração ignorada. RF-002.

### A-05 — Média: compra paga bloqueia edição de Nome e tags

O bloqueio para compras com parcelas pagas/faturas com pagamento ocorre antes de distinguir metadados de campos financeiros. Reproduzido: mudar somente o nome de uma compra paga resulta em “Alteração destrutiva bloqueada”.

Correção: permitir Nome e tags com auditoria e versionamento, preservando plano, parcelas e pagamentos; continuar bloqueando mudanças financeiras destrutivas. RF-006/RF-013. A proteção de RN-006 existe, mas é mais restritiva do que o necessário.

### A-06 — Média: plano continua aberto após a última parcela paga

`pay_invoice` marca as parcelas como pagas, mas não encerra o plano quando não há parcelas pendentes. Reproduzido: compra de uma parcela, fatura totalmente paga, plano ainda com `status='open'`. A interface segue oferecendo Quitar; o comando rejeita por não haver parcelas pendentes.

Correção: recalcular o estado dos planos afetados no mesmo pagamento transacional e derivar a disponibilidade da ação por pendências reais. RF-009.

### A-07 — Média: os filtros dos relatórios alteram os números do Início

`from` e `until` são compartilhados entre Movimentos, Relatórios e os totais do Início. Depois de mudar o período, o Início continua rotulando os números como “no mês até hoje”.

Correção: período mensal próprio para o dashboard ou exibir claramente o período selecionado. Evidência por leitura de `src/App.tsx`.

### A-08 — Média: projeção não entrega a composição prometida

O backend retorna somente dia/saldo real/saldo projetado. Não retorna os componentes realizados, agendados e estimados nem sua origem. O calendário e o cenário existem, mas faltam composição, reconciliação por conta e saldos de abertura visíveis na projeção. RF-011/RN-015.

A projeção só considera recorrências após geração manual. Pausar uma regra não retira ocorrências estimadas já geradas; editar a regra não as ajusta. Isso está documentado, mas precisa de um fluxo claro para “somente futuras”, sem contrariar o que o titular espera da pausa.

### A-09 — Média: revisão diária infere gastos de previsões

`had_spending` é calculado pela existência de qualquer despesa com a data de hoje, inclusive estimada/agendada. Não há escolha explícita “hoje não gastei”. A sequência e o upsert diário existem.

Correção: oferecer declaração explícita de dia com/sem gastos e distinguir previsões de registros efetivos. RF-017.

### A-10 — Funcionalidades ainda não entregues integralmente

- Cartões: somente criação; faltam edição segura do cadastro e gestão de ciclos futuros/inativação.
- Contas: não há fluxo para inativar conta; ajustes são movimentos comuns, sem tipo próprio ou vínculo explícito com a correção.
- Movimentos: filtros existem; agrupamento por período/banco/cartão/status/tags não existe.
- Tags: as cinco tags iniciais especificadas não são provisionadas ou oferecidas como conjunto inicial.
- Lembretes: 13h30 e 20h só são criados ao salvar a primeira subscription, se não existir nenhuma regra. Se o usuário já criou uma regra, os padrões não aparecem.
- Quitação: diferença desconto/juros existe na auditoria, mas não tem apresentação específica para o titular; origem está limitada a conta bancária.
- Configurações: faltam perfil/preferências persistidas. Não há modelo de profiles.
- Pagamentos: não existe fluxo de estorno/reversão para corrigir um pagamento incorreto.
- Exportação: paginação existe, mas várias consultas independentes não garantem um snapshot consistente caso os dados mudem durante a exportação. Não há restauração validada.
- Push: código e estrutura existem; não há evidência de agendador ativo e teste de entrega Android.
- Testes: faltam E2E de navegador, concorrência real entre conexões, matriz completa de ciclos e restauração testada.

## Matriz dos requisitos funcionais

| ID | Situação | Evidência / falta |
| --- | --- | --- |
| RF-001 | Parcial / configuração incorreta | Login comprovado pelo titular, logout/recuperação no código; signup público continua habilitado (A-01). |
| RF-002 | Parcial | Três bancos e saldos iniciais; banco ignorado na edição e sem inativação (A-04). |
| RF-003 | Implementado | Receita/despesa/transferência, data, status e validação SQL. |
| RF-004 | Implementado | PIX/débito exigem conta; crédito exige cartão; invariantes SQL. |
| RF-005 | Implementado com validação de ciclo pendente | Parcelas atômicas e centavos exatos; política do dia do fechamento é escolha registrada no ADR. |
| RF-006 | Parcial | Edição financeira protegida; metadados de compras pagas bloqueados (A-05). |
| RF-007 | Implementado com restrições | Confirmação/motivo, soft delete e auditoria; compras com pagamentos são bloqueadas. |
| RF-008 | Parcial / decisão pendente | Pagamento real e ajuste auditado; sem apresentação do desconto/juros e política final do emissor não validada. |
| RF-009 | Parcial | Criação, faturas e pagamentos; sem edição/inativação de cartão e plano pago continua aberto (A-06). |
| RF-010 | Parcial | Criar/editar/pausar regras mensais; duplicação ao mudar dia (A-02), pausa não trata ocorrências já geradas. |
| RF-011 | Parcial | Calendário, gráfico e saldo diário; sem composição detalhada (A-08). |
| RF-012 | Parcial / decisão pendente | Saldo negativo e limite separados; não projeta o limite disponível dia a dia; taxas e cálculo de encargos não definidos. |
| RF-013 | Parcial | Tags opcionais múltiplas, CRUD e filtros; limitações de edição paga e relatórios (A-03/A-05). |
| RF-014 | Parcial | Busca e filtros por datas/conta/cartão/status/tag; sem agrupamento. |
| RF-015 | Implementado no código | CRUD, dias, horário e habilitação; entrega depende de configuração externa. |
| RF-016 | Parcial / pendente externo | Padrões condicionados à subscription; deep link implementado, sem teste Android real. |
| RF-017 | Parcial | Upsert e sequência; declaração de dia sem gastos é inferida e pode usar estimativas (A-09). |
| RF-018 | Parcial / decisão pendente | Exportação JSON v1; snapshot/restauração não testados. Importação corretamente não habilitada sem contrato. |
| RF-019 | Implementado em escopo reduzido | Cenário altera apenas projeção; é um ajuste único de saldo, sem eventos simulados com data. |
| RF-020 | Parcial | Não soma pagamentos de fatura como segunda despesa nem duplica total por tags; bases diferentes nos relatórios (A-03). |

## Matriz das 16 regras de negócio

| ID | Situação | Verificação |
| --- | --- | --- |
| RN-001 | Implementado | owner_id, RLS, comandos autenticados e FKs compostas; teste cruzado local. |
| RN-002 | Implementado no modelo atual | Conta afeta saldo apenas confirmada e até a data; compra de crédito afeta fatura. Falta data de efetivação separada da competência quando diferentes. |
| RN-003 | Implementado | Pagamentos são saídas separadas; compra no crédito não debita conta. Idempotência exige reutilizar a chave da mesma solicitação. |
| RN-004 | Implementado | Transferência tem duas contas distintas e efeito consolidado neutro. |
| RN-005 | Implementado no fluxo | Centavos inteiros e distribuição de resíduos no comando SQL; soma exata coberta por teste. Invariantes entre todas as linhas não têm constraint diferida própria. |
| RN-006 | Parcial | Bloqueio de reescrita e auditoria existem; não há fluxo de reversão/ajuste vinculado para pagamentos incorretos. |
| RN-007 | Parcial | Quitação preserva parcelas pagas, encerra abertas, audita diferença; falta apresentação de histórico e política de origem por cartão. |
| RN-008 | Implementado, política final pendente | Exige confirmação do emissor e não integra com banco. A representação de antecipação ainda precisa de validação. |
| RN-009 | Implementado | Estimadas/agendadas não entram no saldo real. |
| RN-010 | Parcial / defeito | Regra/data não duplica ao reprocessar sem edição; mudar o dia duplica competência mensal (A-02). |
| RN-011 | Parcial | Zero a N tags, nenhuma categoria obrigatória; faltam Comida, Uber, Compras Pessoais, Entretenimento e Família como conjunto inicial. |
| RN-012 | Parcial | Transação é contada uma vez no geral; aviso de sobreposição existe; falta coerência de status entre totais e grupos (A-03). |
| RN-013 | Implementado | Tag tem soft delete; transação permanece e alterações são auditadas. |
| RN-014 | Parcial / pendente externo | Timezone, weekdays, permissão, unicidade e aviso offline no código; agendador e Android sem validação. |
| RN-015 | Parcial | Premissas resumidas e saldos real/projetado; faltam abertura visível e composição por status/conta na projeção. |
| RN-016 | Implementado no saldo; projeção parcial | Negativo permanece negativo; limite aparece separado. Sem cálculo de encargos e limite disponível futuro. |

## Matriz dos critérios de aceite

Os testes existentes usam valores equivalentes, nem sempre os mesmos valores e bancos dos exemplos. “Teste local” não significa validação de UI/Supabase/Android em produção.

| ID | Resultado da revisão |
| --- | --- |
| AC-01 | Teste SQL local confirma PIX afetando só a conta escolhida. Falta E2E com Nubank real do ambiente de teste. |
| AC-02 | Teste local confirma parcelas e ausência de débito bancário; inclui distribuição R$ 100/3 com resíduo. |
| AC-03 | Teste local confirma baixa única e proteção contra repetição da mesma chave; falta fluxo completo de UI com Santander. |
| AC-04 | Teste local cobre compra R$ 600/3, primeira parcela paga e quitação de R$ 350; preserva histórico e audita desconto de R$ 50. Política final ainda pendente. |
| AC-05 | Lógica de filtro usa inclusão de tag e total geral por transação; não há teste automatizado específico Comida/Família. Relatórios têm A-03. |
| AC-06 | Teste local confirma recorrência estimada sem aumentar saldo real; falha adicional quando muda o dia (A-02). |
| AC-07 | Teste local cobre chave única de entrega; não executa o agendador duas vezes nem valida envio às 20h em dispositivo. |
| AC-08 | Bloqueios implementados e testados para versão e compras pagas; edição financeira de PIX confirmado também é bloqueada. Falta teste específico abrangente dessa proteção. |
| AC-09 | Teste local confirma transferência neutra no consolidado. |
| AC-10 | Teste cobre auditoria e soft delete; falta E2E comprovando desaparecimento das visões e recálculo da projeção após exclusão. |

## Escopo e decisões que devem permanecer explícitos

- Os números ilustrativos dos documentos não devem virar saldos ou movimentos automaticamente. Isso continua respeitado.
- Saldos, limite e vínculo de cheque especial, cartões/ciclos e encargos dependem dos dados reais do titular.
- Dinheiro físico/Carteira ainda não foi aprovado; não deve ser acrescentado como fato consumado.
- Compra no dia do fechamento indo para o próximo ciclo é escolha reversível documentada, não regra universal já confirmada pelo titular.
- Antecipação de cartão com desconto/juros e sua representação na fatura ainda precisam de política aprovada.
- Online foi adotado como escolha reversível; offline-first permanece fora do fluxo atual.
- Restauração, retenção, backups e custos/infraestrutura de push continuam pendentes.
- Nome, valor, data, meio de pagamento e tags são os campos de conteúdo solicitados pelo titular. Conta/cartão e parcelas são exigências condicionais do meio; tipo/status existem para as regras financeiras e podem receber uma apresentação mais simples, sem remover sua semântica silenciosamente.

## Validação executada nesta revisão

1. Leitura de ambas as especificações e comparação com frontend, migrações, função de push e documentação.
2. `npm.cmd run lint` e `npm.cmd run typecheck`: passaram.
3. `npm.cmd test`: 17 testes passaram, sem testes novos de aceitação alegados.
4. `node scripts/audit-business.mjs`: reproduziu A-02, A-04, A-05 e A-06 em PostgreSQL embarcado descartável. O script registra os resultados observados; não é uma suíte que declare os defeitos como comportamento correto.
5. GET de configuração pública do Auth: cadastro público ainda habilitado. Nenhuma operação de escrita foi feita no projeto Supabase.

Não foram executados login automatizado com credenciais do titular, consultas aos seus lançamentos, testes de carga, concorrência real, E2E, envio push ou alteração de configuração do Supabase.

## Ordem sugerida de correção

1. Restringir signup no Supabase; corrigir recorrência por competência e coerência dos relatórios.
2. Corrigir edição de conta, metadados de compra paga e fechamento de plano totalmente pago.
3. Separar filtros do dashboard, completar composição da projeção e revisão diária explícita.
4. Completar gestão de cartões/contas, tags iniciais, agrupamentos e horários padrões.
5. Validar políticas pendentes e executar os dez cenários de aceite em Supabase/navegador/Android de teste.

Como o banco já foi instalado, correções devem usar **novas migrações incrementais**. Não executar `setup.sql` novamente nem presumir que mudar um arquivo local altera o banco existente.
