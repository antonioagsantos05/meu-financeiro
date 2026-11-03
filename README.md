# Meu Financeiro

Aplicativo privado em React, TypeScript e Vite, com Supabase Auth/PostgreSQL e interface responsiva em português. Implementação baseada nas duas especificações fornecidas em 03/11/2026.

```powershell
npm.cmd ci
npm.cmd run dev
```

**Configuração necessária:** ainda não existe um projeto Supabase conectado. Siga [o guia de configuração](docs/SETUP.md) para criar o banco, aplicar migrações e provisionar o acesso privado. Sem essa configuração, a aplicação mostra as instruções; não simula dados nem persistência.

Implementado: contas, movimentos e transferências, tags, cartões e parcelas, faturas e pagamento parcial, quitação auditada, recorrências mensais, projeção diária e cenários, relatórios básicos, horários de lembretes, revisão diária, exportação JSON, manifest e service worker. As operações financeiras executam no banco, com isolamento, idempotência e controle de versão.

Preparado para configuração externa: Supabase, recuperação por e-mail, Netlify e Web Push. Não houve deploy. A função de envio push e a instalação Android precisam de validação real. Importação/restauração, encargos e decisões contábeis pendentes não são apresentados como recursos concluídos.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Consulte [decisões e limites](docs/adr/0001-decisoes.md) e [contrato de operações](docs/API.md).
