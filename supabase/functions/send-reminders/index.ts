// Deploy separately to Supabase Edge Functions. No provider is selected for scheduling.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing ${name}`); return value }
Deno.serve(async (request: Request) => {
 if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
 const secret = Deno.env.get('CRON_SECRET')
 if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 })
 try {
  const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'))
  webpush.setVapidDetails(required('VAPID_SUBJECT'), required('VAPID_PUBLIC_KEY'), required('VAPID_PRIVATE_KEY'))
  const now = new Date()
  const { data: rules, error } = await db.from('reminder_rules').select('*').eq('enabled', true)
  if (error) throw error
  let sent = 0, failed = 0
  for (const rule of rules || []) {
   const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: rule.timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23', weekday:'short' }).formatToParts(now).map(p=>[p.type,p.value]))
   const localDate = `${parts.year}-${parts.month}-${parts.day}`
   const weekday = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.weekday)+1
   const [hour, minute] = rule.local_time.split(':').map(Number)
   const late = Number(parts.hour)*60+Number(parts.minute)-(hour*60+minute)
   if (!rule.weekdays.includes(weekday) || late<0 || late>=10) continue
   const { data: claim, error: claimError } = await db.from('reminder_deliveries').insert({owner_id:rule.owner_id,rule_id:rule.id,local_date:localDate,scheduled_time:rule.local_time,status:'claimed'}).select('id').single()
   if (claimError?.code==='23505') continue
   if (claimError) throw claimError
   const { data: subscriptions, error: subscriptionError } = await db.from('push_subscriptions').select('*').eq('owner_id',rule.owner_id).is('revoked_at',null)
   if (subscriptionError) throw subscriptionError
   let delivered = false
   for (const subscription of subscriptions || []) {
    try {
     await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify({title:'Meu Financeiro',body:'Que tal revisar seu dia?',url:'/movimentos/novo',tag:`review-${rule.id}-${localDate}`}),{TTL:600,timeout:10000})
     delivered = true; sent++
    } catch (e) {
     failed++
     const status = (e as {statusCode?:number}).statusCode
     if (status===404 || status===410) await db.from('push_subscriptions').update({revoked_at:now.toISOString()}).eq('id',subscription.id)
    }
   }
   const { error: updateError } = await db.from('reminder_deliveries').update({status:delivered?'sent':subscriptions?.length?'failed':'no_subscription'}).eq('id',claim.id)
   if (updateError) throw updateError
  }
  return Response.json({sent,failed})
 } catch { return Response.json({error:'reminder_dispatch_failed'}, {status:500}) }
})
