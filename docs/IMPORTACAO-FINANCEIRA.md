# Importação do pacote financeiro

A importação é separada de restauração genérica. O pacote tem contas/cartões, faturas agregadas, compromissos, assinaturas e informações sem confirmação. Todos os dados de origem são preservados com RLS e vínculo ao titular.

Os dados pessoais extraídos, o SQL de carga e o relatório local ficam em `private-imports/`, ignorado pelo Git. Não copiar esses arquivos para public/, dist/ ou documentação pública.

## Executar a carga preparada

Abrir `private-imports/IMPORTAR_NO_SUPABASE.sql`, copiar todo o conteúdo e executar no SQL Editor do projeto correto. Esse arquivo:

1. Instala as migrações de Santander e importação se ainda não estiverem instaladas.
2. Confere que o UUID do titular existe no projeto.
3. Executa a carga com o contexto desse titular, em transação.
4. Retorna resumo da carga. Repetir o mesmo pacote não duplica registros; alterar o conteúdo com a mesma chave gera erro.

Não executar setup.sql novamente. O arquivo de carga não cria um novo usuário, não apaga registros e não substitui valores divergentes de faturas já existentes. Se houver várias contas/cartões candidatos ao mesmo banco, aborta para conciliação, em vez de escolher arbitrariamente.

Ainda é necessário executar esse SQL no projeto Supabase: a preparação e os testes locais não constituem carga em produção. Não há credenciais administrativas de conexão disponíveis ao agente.

## Tratamento aplicado

- A confirmação do saldo Santander pelo titular prevalece sobre o metadado antigo de saldo não confirmado. Nubank/Itaú não recebem uma cópia desse saldo.
- Uma conta Santander nova recebe o saldo confirmado. Conta existente sem movimentos pode ter abertura corrigida; conta já movimentada com saldo diferente fica com pendência de conciliação, sem sobrescrever histórico.
- Conta vinculada ao cartão representa origem prevista do pagamento, Santander. O emissor é preservado separadamente. Cartões existentes são reutilizados quando identificáveis.
- Faturas agregadas não viram compras parceladas fictícias. Pagamentos delas continuam sendo saídas bancárias únicas.
- Assinaturas são registros de componentes das faturas, visíveis em Recorrências. Não geram débitos de conta independentes nem novas cobranças sobre os agregados importados.
- Compromissos bancários datados entram como agendados. Não são marcados pagos sem evidência.
- Recebimentos com data não confirmada ficam identificados como pendentes. Após a solicitação do titular para considerar entradas futuras, a migração 202611030005 inclui seus valores na projeção pela data provisória existente no pacote, sem aumentar saldo real. Sessões e recorrências sem nenhum dia definido continuam fora do calendário.
- Possíveis cobranças duplicadas ficam preservadas, mas excluídas do caixa até confirmação.
- Acréscimos de assinatura sujeitos a conciliação permanecem nos metadados e avisos. Não são somados automaticamente à fatura-base.
- O cenário simplificado do pacote é exibido separadamente da projeção operacional, identificado como ilustrativo, com suas exclusões/estimativas e sem encargos de cheque especial.
- Fechamento de cartão desconhecido é NULL. Novas compras nesse cartão são bloqueadas até informar seu fechamento; faturas importadas continuam visíveis e pagáveis.

O painel de origem/pendências aparece em Configurações, as recorrências/assinaturas em Recorrências e os avisos em Futuro. A exportação inclui os novos registros de importação.

## Reproduzir a preparação local

Extraia `dados_financeiros.json` do ZIP para `private-imports/` e execute:

```text
node scripts/prepare-financial-import.mjs UUID_DO_TITULAR SALDO_CONFIRMADO_EM_CENTAVOS
```

O script testa o pacote real apenas em PostgreSQL embarcado descartável, verifica repetição, gera o arquivo e valida também o SQL final em uma segunda base local. Os testes de CI usam um pacote sintético e não dependem dos dados privados.

Pendências só devem ser ativadas após confirmação de data/valor/vínculo. A carga não implementa uma restauração universal, nem altera as decisões pendentes sobre juros, backups e políticas contábeis.

## Atualização da projeção de entradas

Para banco já carregado, executar somente `supabase/migrations/202611030005_forecast_expected_income.sql`. Não reimportar nem duplicar receitas manualmente. As entradas continuam estimadas até recebimento efetivo. O backend evita contar a mesma entrada importada de mais de um pacote e evita somá-la novamente quando existe uma receita de mesmo valor/data na conta.
