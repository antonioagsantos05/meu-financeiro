import { supabase } from './supabase'
export const pushConfigured =
  import.meta.env.VITE_PUSH_ENABLED === 'true' &&
  !!import.meta.env.VITE_VAPID_PUBLIC_KEY
export async function testNotification() {
  if (
    !window.isSecureContext ||
    !('serviceWorker' in navigator) ||
    !('Notification' in window)
  )
    throw new Error(
      'Abra em localhost ou HTTPS em um navegador com notificações.',
    )
  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error(
      'Permita as notificações nas configurações deste site no navegador.',
    )
  await navigator.serviceWorker.register('/sw.js')
  const registration = await navigator.serviceWorker.ready
  await registration.showNotification('Meu Financeiro', {
    body: 'Teste de notificação. Que tal revisar seu dia?',
    icon: '/icon-192.png',
    tag: 'notification-test',
    data: { url: '/movimentos/novo' },
  })
}
export async function enablePush() {
  if (!supabase || !pushConfigured)
    throw new Error(
      'Configure as chaves VAPID e o agendador antes de ativar o envio.',
    )
  if (!('serviceWorker' in navigator) || !('PushManager' in window))
    throw new Error('Este navegador não oferece Web Push.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error('Permissão para notificações não concedida.')
  await navigator.serviceWorker.register('/sw.js')
  const registration = await navigator.serviceWorker.ready
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(
    atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  )
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }))
  const { error } = await supabase.rpc('save_push_subscription', {
    subscription: subscription.toJSON(),
  })
  if (error) throw error
}
export async function disablePush() {
  if (!supabase) return
  const { error } = await supabase.rpc('revoke_push_subscriptions')
  if (error) throw error
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  }
}
