# Configuração

## Ambiente local

Requer Node.js 22.12 ou superior. No PowerShell, use `npm.cmd` quando a política bloquear `npm.ps1`.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

## Banco e acesso privado

1. Crie um projeto Supabase na sua conta. Confira limites e custos do plano e guarde a senha do banco fora do repositório.
2. Em Authentication, desabilite novos cadastros públicos e login anônimo. Crie o único usuário administrativamente. Não há signup no aplicativo.
3. Execute no SQL Editor, nesta ordem, `supabase/migrations/202611030001_initial.sql` e `202611030002_push.sql`. Também é possível aplicar com a CLI Supabase.
4. Preencha `.env.local` com URL do projeto e chave pública anon/publishable:

```dotenv
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
VITE_VAPID_PUBLIC_KEY=
VITE_PUSH_ENABLED=false
```

5. Reinicie o Vite. Configure Site URL, redirects autorizados e serviço de e-mail do Auth. Teste recuperação de senha.
6. Entre e cadastre contas, saldos, limites e cartões reais. Os exemplos dos documentos não são lançados automaticamente.

Nunca use service_role em variáveis VITE_*. A chave pública é protegida por RLS e permissões SQL. Faça os cenários de aceite em ambiente separado antes de usar dados reais.

## Validação

Execute lint, typecheck, test e build conforme o README. Os testes executam as migrações em PostgreSQL embarcado (PGlite), com roles e auth.uid() simulados. Não substituem testes de Auth/PostgREST/Supabase real, concorrência entre conexões, e-mail, navegador e Android.

## Netlify

Importe o repositório no Netlify e configure as variáveis públicas no ambiente de build. `netlify.toml` configura build, diretório dist, fallback SPA e cabeçalhos. Autorize o domínio HTTPS nos redirects do Supabase. Nenhum deploy foi realizado nesta entrega.

## Web Push opcional

O CRUD de horários funciona sem push. O envio depende de configuração adicional:

1. Gere um par VAPID com uma ferramenta Web Push. Guarde a chave privada somente no servidor; VAPID_SUBJECT deve ser um contato mailto ou HTTPS válido.
2. Configure os secrets da Edge Function: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT e CRON_SECRET forte. O ambiente Supabase fornece SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
3. Faça deploy de `supabase/functions/send-reminders`. O config.toml desabilita a validação JWT dessa função, pois ela exige seu próprio Bearer CRON_SECRET. Preserve a autenticação interna.
4. Configure um agendador para enviar POST à função a cada cinco minutos, com Authorization: Bearer CRON_SECRET. Nenhum provedor foi contratado ou escolhido. Valide disponibilidade, custos e proteção de secrets.
5. Após validar o agendador, configure VITE_VAPID_PUBLIC_KEY e VITE_PUSH_ENABLED=true e publique outro build.
6. Em HTTPS, use “Ativar neste dispositivo” em Lembretes. A permissão é explícita. Se não houver regras, o banco cria 13h30 e 20h. Edite dias e horários como preferir.

A função usa janela de dez minutos, timezone e unicidade por regra/data/horário. A ocorrência é reservada antes do envio; uma interrupção pode perder a mensagem, mas reexecutar não a duplica. Falhas ficam registradas sem tentativas automáticas. Endpoints 404/410 são revogados. O conteúdo é genérico e abre /movimentos/novo.

As dependências Deno, a execução real da Edge Function e a entrega em Android ainda não foram verificadas. Push pode atrasar ou falhar offline e com economia de bateria. “Revogar dispositivos” desativa todas as subscriptions do titular. Logout não revoga subscriptions.

## Limites de operação

- Movimentos têm exclusão lógica, motivo e auditoria. Não há exclusão física pela interface.
- Faturas com pagamentos impedem reescrita de compras relacionadas. Pagamento parcial baixa somente o valor efetivo.
- Quitação exige confirmação no emissor e bloqueia faturas parcialmente pagas. Não executa operação bancária.
- Recorrências são mensais. Alterações afetam ocorrências ainda não geradas; edite as existentes em Movimentos.
- Exportação JSON v1 inclui histórico e auditoria, sem chaves push. Restauração/importação e retenção ainda precisam de contrato e testes.
- Contas e cartões históricos são preservados. Ciclos históricos não são editados; reversão de pagamentos ainda não tem fluxo aprovado.
- Apenas a página pública de indisponibilidade é armazenada pelo service worker. CRUD exige conexão.
- Encargos de cheque especial não são calculados sem regra aprovada.
