import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Proxies the Brandible buyer export to the client.
// Keeps BRANDIBLE_SERVICE_ROLE_KEY server-side only.
export async function GET() {
  // Require a logged-in WACRM user
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const brandibleUrl  = process.env.BRANDIBLE_SUPABASE_URL
  const brandibleKey  = process.env.BRANDIBLE_SERVICE_ROLE_KEY

  if (!brandibleUrl || !brandibleKey) {
    return NextResponse.json(
      { error: 'Brandible integration not configured. Add BRANDIBLE_SUPABASE_URL and BRANDIBLE_SERVICE_ROLE_KEY to WACRM env.' },
      { status: 503 }
    )
  }

  try {
    const res = await fetch(
      `${brandibleUrl}/functions/v1/export-buyers-csv`,
      { headers: { Authorization: `Bearer ${brandibleKey}` } }
    )

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Brandible export failed: ${text}` }, { status: 502 })
    }

    const csv = await res.text()

    // Parse CSV into { phone, name }[] for the broadcast audience
    const lines = csv.split('\n').filter(Boolean)
    const [header, ...rows] = lines
    const cols = header.split(',')
    const phoneIdx  = cols.indexOf('phone')
    const ordersIdx = cols.indexOf('orders')
    const spendIdx  = cols.indexOf('total_spend_ngn')

    const contacts = rows.map(row => {
      const cells = row.split(',')
      const phone  = cells[phoneIdx]?.trim() ?? ''
      const orders = cells[ordersIdx]?.trim() ?? '1'
      const spend  = cells[spendIdx]?.trim() ?? '0'
      return {
        phone,
        name: `Brandible Customer (${orders} order${orders === '1' ? '' : 's'} · ₦${Number(spend).toLocaleString('en-NG')})`,
      }
    }).filter(c => c.phone)

    return NextResponse.json({ contacts, count: contacts.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
