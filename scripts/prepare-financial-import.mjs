import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const owner = process.argv[2]
if (!/^[0-9a-f-]{36}$/i.test(owner || ''))
  throw new Error(
    'Informe o UUID do titular: node scripts/prepare-financial-import.mjs UUID',
  )
const payload = JSON.parse(
  readFileSync('private-imports/dados_financeiros.json', 'utf8'),
)
const confirmedBalance = Number(process.argv[3])
if (!Number.isSafeInteger(confirmedBalance))
  throw new Error('Informe também o saldo confirmado em centavos.')
const batchKey = 'pacote-financeiro-2026-11-03-v1'
const migrations = [
  '202611030001_initial.sql',
  '202611030003_santander_cash_account.sql',
  '202611030004_financial_import.sql',
]
const db = new PGlite()
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 insert into auth.users values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);`)
  for (const file of migrations)
    await db.exec(
      readFileSync('supabase/migrations/' + file, 'utf8').replace(
        'create extension if not exists pgcrypto;',
        '',
      ),
    )
  await db.exec('set role authenticated')
  const call = () =>
    db.query('select import_financial_package($1::jsonb,$2,$3) result', [
      JSON.stringify(payload),
      batchKey,
      confirmedBalance,
    ])
  const first = await call(),
    second = await call()
  if (JSON.stringify(first.rows) !== JSON.stringify(second.rows))
    throw new Error('Falha de idempotência')
  const counts = await db.query(
    `select (select count(*) from accounts) accounts,(select count(*) from cards) cards,(select count(*) from invoices) invoices,(select count(*) from transactions) transactions,(select count(*) from financial_import_records) source_records`,
  )
  const balances = await db.query(
    'select a.bank_code,b.balance_cents from get_account_balances() b join accounts a on a.id=b.account_id order by a.bank_code',
  )
  const report = {
    package_sha256: createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex'),
    result: first.rows[0].result,
    counts: counts.rows[0],
    balances: balances.rows,
    idempotent: true,
    environment: 'Disposable PGlite; not production',
  }
  writeFileSync(
    'private-imports/validacao-local.json',
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(JSON.stringify(report, null, 2))
  const migration = readFileSync(
    'supabase/migrations/202611030004_financial_import.sql',
    'utf8',
  )
    .replace(/^begin;\s*/, '')
    .replace(/commit;\s*$/, '')
  const cashMigration = readFileSync(
    'supabase/migrations/202611030003_santander_cash_account.sql',
    'utf8',
  )
    .replace(/^[\s\S]*?begin;\s*/, '')
    .replace(/commit;\s*$/, '')
  const quote = JSON.stringify(payload).replace(/'/g, "''")
  const sql = `-- Dados pessoais: arquivo ignorado pelo Git. Não publicar.\n-- Executar no SQL Editor do SEU projeto. Não recria usuário nem apaga histórico.\nbegin;\nDO $cash$ begin\n if to_regprocedure('public.enforce_santander_cash()') is null then execute $cashddl$${cashMigration}$cashddl$; end if;\nend $cash$;\nDO $install$ begin\n if to_regprocedure('public.import_financial_package(jsonb,text,bigint)') is null then\n execute $ddl$${migration}$ddl$;\n end if;\nend $install$;\nDO $owner$ begin\n if not exists(select 1 from auth.users where id='${owner}') then raise exception 'Titular não encontrado neste projeto'; end if;\nend $owner$;\nselect set_config('request.jwt.claim.sub','${owner}',true);\nset local role authenticated;\nselect public.import_financial_package('${quote}'::jsonb,'${batchKey}',${confirmedBalance});\ncommit;\n`
  // Verify the exact SQL handoff, including the installation guard, in an isolated database.
  await db.exec('reset role')
  await db.exec(sql)
  const fresh = new PGlite()
  try {
    await fresh.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
      insert into auth.users values('${owner}');`)
    for (const file of migrations.slice(0, 1))
      await fresh.exec(
        readFileSync('supabase/migrations/' + file, 'utf8').replace(
          'create extension if not exists pgcrypto;',
          '',
        ),
      )
    await fresh.exec(sql)
    await fresh.exec(sql)
    const result = await fresh.query(
      'select count(*)::int total from financial_import_records',
    )
    if (result.rows[0].total !== Number(counts.rows[0].source_records))
      throw new Error('SQL final não preservou idempotência')
  } finally {
    await fresh.close()
  }
  writeFileSync('private-imports/IMPORTAR_NO_SUPABASE.sql', sql)
  console.log(
    'Prepared private-imports/IMPORTAR_NO_SUPABASE.sql; no production changes performed.',
  )
} finally {
  await db.close()
}
