import { createECDH, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const directory = 'private-imports'
mkdirSync(directory, { recursive: true })
const envPath = `${directory}/push-secrets.env`
const local = readFileSync('.env.local', 'utf8')
const url = local.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '')
if (!url) throw new Error('VITE_SUPABASE_URL ausente')
const project = new URL(url).hostname.split('.')[0]
if (!existsSync(envPath)) {
  const key = createECDH('prime256v1')
  key.generateKeys()
  writeFileSync(envPath, `VAPID_PUBLIC_KEY=${key.getPublicKey().toString('base64url')}\nVAPID_PRIVATE_KEY=${key.getPrivateKey().toString('base64url')}\nVAPID_SUBJECT=${url}\nCRON_SECRET=${randomBytes(32).toString('hex')}\n`)
}
const secrets = Object.fromEntries(readFileSync(envPath, 'utf8').trim().split('\n').map(line => line.split('=')))
const quote = value => "'" + value.replaceAll("'", "''") + "'"
writeFileSync(`${directory}/ATIVAR_NOTIFICACOES.sql`, `-- Privado. Executar no SQL Editor depois de publicar a Edge Function.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
DO $vault$ declare secret_id uuid; begin
 select id into secret_id from vault.secrets where name='finance_reminder_cron';
 if secret_id is null then
  perform vault.create_secret(${quote(secrets.CRON_SECRET)},'finance_reminder_cron');
 else
  perform vault.update_secret(secret_id,${quote(secrets.CRON_SECRET)});
 end if;
end $vault$;
select cron.schedule('finance-reminders-every-minute','* * * * *',
 $job$select net.http_post(
  url := ${quote(url + '/functions/v1/send-reminders')},
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='finance_reminder_cron')),
  body := '{}'::jsonb,
  timeout_milliseconds := 15000
 );$job$);
commit;
`)
if (process.argv.includes('--deploy')) {
  for (const args of [
    ['supabase', 'secrets', 'set', '--env-file', envPath, '--project-ref', project],
    ['supabase', 'functions', 'deploy', 'send-reminders', '--project-ref', project],
  ]) {
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', shell: process.platform === 'win32' })
    if (result.status !== 0) process.exit(result.status || 1)
  }
  let updated = local
  for (const [name, value] of Object.entries({ VITE_VAPID_PUBLIC_KEY: secrets.VAPID_PUBLIC_KEY, VITE_PUSH_ENABLED: 'true' })) {
    const pattern = new RegExp(`^${name}=.*$`, 'm')
    updated = pattern.test(updated) ? updated.replace(pattern, `${name}=${value}`) : updated + `\n${name}=${value}\n`
  }
  writeFileSync('.env.local', updated)
  console.log('Funcao publicada. Execute private-imports/ATIVAR_NOTIFICACOES.sql e reinicie o frontend. Depois ative este dispositivo em Lembretes.')
} else {
  console.log('Chaves e SQL preparados em private-imports (ignorados pelo Git). Para publicar: npx supabase login; depois node scripts/configure-push.mjs --deploy')
}
