import Stripe from 'npm:stripe@18.4.0'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const creditPacks: Record<number,{name:string,price:number}> = {
  10: { name: '10 One:2:Us Credits', price: 990 },
  25: { name: '25 One:2:Us Credits', price: 1990 },
  60: { name: '60 One:2:Us Credits', price: 3990 }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  try {
    const auth = req.headers.get('Authorization') || ''
    const client = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { kind, quantity, successUrl, cancelUrl } = await req.json()
    let item
    let metadata: Record<string,string> = { user_id: user.id, kind }

    if (kind === 'credits') {
      const pack = creditPacks[Number(quantity)]
      if (!pack) return json({ error: 'Unknown credit pack' }, 400)
      item = { price_data: { currency: 'eur', product_data: { name: pack.name }, unit_amount: pack.price }, quantity: 1 }
      metadata.credits = String(quantity)
    } else if (kind === 'event') {
      const admin = createClient(supabaseUrl, serviceKey)
      const { data: event, error } = await admin.from('events').select('id,title,price_cents').eq('id', quantity).single()
      if (error || !event) return json({ error: 'Event not found' }, 404)
      item = { price_data: { currency: 'eur', product_data: { name: event.title }, unit_amount: event.price_cents }, quantity: 1 }
      metadata.event_id = event.id
    } else return json({ error: 'Unknown checkout type' }, 400)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [item],
      success_url: `${successUrl}${successUrl.includes('?')?'&':'?'}payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelUrl}${cancelUrl.includes('?')?'&':'?'}payment=cancelled`,
      customer_email: user.email,
      metadata,
      allow_promotion_codes: true
    })
    return json({ url: session.url })
  } catch (e) { return json({ error: e.message || 'Checkout error' }, 500) }
})

function cors(){ return { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' } }
function json(body: unknown,status=200){ return new Response(JSON.stringify(body),{status,headers:{...cors(),'Content-Type':'application/json'}}) }
