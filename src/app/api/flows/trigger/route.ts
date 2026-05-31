import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { triggerOutboundFlow } from '@/lib/flows/engine'

// Lazy service-role client — same pattern as the webhook handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * POST /api/flows/trigger
 *
 * Start an api_trigger flow for a contact without requiring an inbound message.
 * Called by external systems (Brandible, payment processors, schedulers, etc.)
 * after events like payment confirmed, appointment reminder, subscription renewal.
 *
 * Auth: Authorization: Bearer {WACRM_TRIGGER_API_KEY}
 *
 * Body:
 * {
 *   "user_id":     "uuid",               // wacrm account that owns the flow
 *   "trigger_key": "activation_confirmed",// matches flow's api_trigger trigger_key
 *   "phone":       "+2348012345678",      // customer's WhatsApp number
 *   "vars": {                             // optional — seeded into flow_runs.vars
 *     "campaign_title": "Health360",
 *     "amount_ngn": "5000"
 *   }
 * }
 */
export async function POST(request: Request) {
  // ── Auth ─────────────────────────────────────────────────────
  const apiKey = process.env.WACRM_TRIGGER_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Trigger API not configured on this server' },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (token !== apiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ───────────────────────────────────────────────
  let body: {
    user_id?: string
    trigger_key?: string
    phone?: string
    vars?: Record<string, unknown>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { user_id, trigger_key, phone, vars } = body

  if (!user_id)     return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  if (!trigger_key) return NextResponse.json({ error: 'trigger_key is required' }, { status: 400 })
  if (!phone)       return NextResponse.json({ error: 'phone is required' }, { status: 400 })

  const normalizedPhone = normalizePhone(phone)

  try {
    // ── Find or create contact ───────────────────────────────────
    const { data: contacts, error: contactsErr } = await supabaseAdmin()
      .from('contacts')
      .select('id, phone, name')
      .eq('user_id', user_id)

    if (contactsErr) throw new Error(`Contact lookup failed: ${contactsErr.message}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let contact = (contacts ?? []).find((c: any) => phonesMatch(c.phone, normalizedPhone))

    if (!contact) {
      const { data: newContact, error: createErr } = await supabaseAdmin()
        .from('contacts')
        .insert({ user_id, phone: normalizedPhone, name: normalizedPhone })
        .select('id, phone, name')
        .single()

      if (createErr) throw new Error(`Contact creation failed: ${createErr.message}`)
      contact = newContact
    }

    // ── Find or create conversation ──────────────────────────────
    const { data: existingConv } = await supabaseAdmin()
      .from('conversations')
      .select('id')
      .eq('user_id', user_id)
      .eq('contact_id', contact.id)
      .maybeSingle()

    let conversationId: string

    if (existingConv) {
      conversationId = existingConv.id
    } else {
      const { data: newConv, error: convErr } = await supabaseAdmin()
        .from('conversations')
        .insert({ user_id, contact_id: contact.id })
        .select('id')
        .single()

      if (convErr) throw new Error(`Conversation creation failed: ${convErr.message}`)
      conversationId = newConv.id
    }

    // ── Trigger the flow ─────────────────────────────────────────
    const result = await triggerOutboundFlow({
      userId: user_id,
      contactId: contact.id,
      conversationId,
      triggerKey: trigger_key,
      initialVars: {
        _customer_phone: normalizedPhone,
        ...(vars ?? {}),
      },
    })

    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
    })
  } catch (err) {
    console.error('[/api/flows/trigger] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
