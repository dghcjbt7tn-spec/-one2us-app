import Stripe from 'npm:stripe@18.4.0'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })
  const body = await req.text()
  let event: Stripe.Event
  try { event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret) }
  catch { return new Response('Invalid signature', { status: 400 }) }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.user_id
    const kind = session.metadata?.kind
    if (userId && kind === 'credits') {
      const credits = Number(session.metadata?.credits || 0)
      if (credits > 0) {
        const { data: profile } = await supabase.from('profiles').select('credits').eq('id', userId).single()
        await supabase.from('profiles').update({ credits: (profile?.credits || 0) + credits }).eq('id', userId)
        await supabase.from('credit_transactions').insert({ user_id: userId, amount: credits, reason: 'stripe_purchase', stripe_checkout_session_id: session.id })
      }
    }
    if (userId && kind === 'event' && session.metadata?.event_id) {
      await supabase.from('event_bookings').upsert({
        event_id: session.metadata.event_id,
        user_id: userId,
        stripe_checkout_session_id: session.id,
        payment_status: 'paid'
      }, { onConflict: 'event_id,user_id' })
    }
  }
  return new Response('ok')
})
