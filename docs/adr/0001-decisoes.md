# Decisões de implementação

Implementação local React/TypeScript/Vite, Supabase e Netlify conforme os documentos fornecidos. CSS próprio, sem dependência de Tailwind. Nenhum dado financeiro ilustrativo é inserido.

Escolhas reversíveis: operação online; service worker armazena somente shell público, nunca respostas financeiras; datas civis no fuso America/Sao_Paulo; compra no dia do fechamento entra no ciclo seguinte; vencimento é o primeiro dia configurado estritamente posterior ao fechamento. Validar estas duas políticas com o titular antes do uso real.

Contas, saldos, limites, cartões e ciclos devem ser preenchidos pelo titular. Encargos de cheque especial não são estimados sem regra aprovada. Exportação JSON versão 1; restauração não oferecida até definição de contrato e validações.

Quitação antecipada de cartão exige confirmação da operação no emissor. O pagamento real reduz o caixa e as parcelas abertas são encerradas, com diferença explícita auditada; não dispara operação no banco. Validar esta representação antes de produção.

Web Push: provedor, custo e agendamento pendentes. Há registro de subscriptions, revogação e Edge Function com autenticação própria e deduplicação. A interface mantém ativação desabilitada até configuração explícita. A função de envio não foi executada em ambiente Supabase/Android. Recuperação usa e-mail do Supabase com redirect previamente autorizado.

Gates externos: provisionar Supabase, desabilitar signup, executar migrações/testes de isolamento, configurar e-mail/redirects e Netlify, validar Android e contratar/configurar agendador push. Não considerar estes gates concluídos pelo build local.
