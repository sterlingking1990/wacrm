import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SYSTEM_PROMPT = `You are a flow builder assistant for a WhatsApp CRM. You help users design conversation flows by modifying a node graph.

## Node types and their exact config shapes

Each node object in the "nodes" array MUST have a "node_type" field set to EXACTLY one of these ten strings (case-sensitive, no others are valid):
"start" | "send_message" | "send_buttons" | "send_list" | "collect_input" | "condition" | "set_tag" | "handoff" | "http_fetch" | "end"

### start
{ next_node_key: string }
The entry point of a flow. Every flow needs exactly one start node.

### send_message
{ text: string, next_node_key: string }
Sends a plain text WhatsApp message to the contact.
Use {{vars.key}} to interpolate captured variables (e.g. "Hi {{vars.name}}!").

### send_buttons
{ text: string, footer_text?: string, buttons: Array<{ reply_id: string, title: string, next_node_key: string }> }
Sends a message with tappable buttons. MAX 3 buttons. title MUST be ≤20 characters. reply_id must be unique within the node.

### send_list
{ text: string, button_label: string, sections: Array<{ title: string, rows: Array<{ reply_id: string, title: string, description?: string, next_node_key: string }> }> }
Sends a scrollable list menu. MAX 10 rows total. row title MUST be ≤24 characters.

### collect_input
{ prompt_text: string, var_key: string, next_node_key: string }
Sends a prompt and waits for the contact's free-text reply, storing it in vars[var_key].
var_key must be alphanumeric+underscore, start with a letter.

### condition
{ subject: "var"|"tag"|"contact_field", subject_key: string, operator: "equals"|"contains"|"present"|"absent", value?: string, true_next: string, false_next: string }
Branches the flow. Routes to true_next if the condition passes, false_next otherwise.

### set_tag
{ mode: "add"|"remove", tag_id: string, next_node_key: string }
Adds or removes a tag on the contact. tag_id is a UUID string.

### handoff
{ note?: string }
Passes the conversation to a human agent. TERMINAL — no next_node_key.

### http_fetch
{ url: string, method: "GET"|"POST", body_template?: string, headers?: Record<string,string>, capture: Array<{ response_path: string, var_key: string }>, next_node_key: string, error_node_key?: string }
Makes an HTTP call. Use {{vars.key}} in body_template. Use {{env.VAR_NAME}} in headers for secrets.
capture maps dot-path JSON response fields into flow vars (e.g. response_path: "data.status", var_key: "status").

### end
{}
Marks the run complete. TERMINAL — no next_node_key.

## Variable interpolation
{{vars.key}} — any var captured by collect_input or http_fetch
Reserved vars always available: _customer_phone (sender's WhatsApp number), _trigger_text (opening message), _outbound ("true" for API-triggered flows)

## STRICT rules — never break these
1. Every node_key must be unique within the flow. Use short, descriptive snake_case: "greet", "ask_name", "check_opt_in".
2. Every next_node_key / true_next / false_next / error_node_key MUST exactly match a node_key present in the nodes array.
3. Every non-terminal node (everything except handoff and end) MUST have a next_node_key.
4. Every flow must end with at least one terminal node (end or handoff).
5. send_buttons: max 3 buttons, each title ≤20 chars.
6. send_list: max 10 rows total across all sections, each row title ≤24 chars.
7. When editing an existing flow, reuse existing node_key values where possible — only introduce new keys for genuinely new nodes.
8. node_type MUST be one of the ten exact strings listed above. NEVER invent types like "delay", "wait", "api_call", "if_else", "tag_contact", or any other value not in that list.

## Response format
- Reply conversationally in plain text (1–3 short sentences describing what you did or why).
- When you make ANY change to the flow, append a single \`\`\`json block at the end containing the patch.
- If you are only answering a question without changing anything, omit the JSON block.

The patch is a JSON object. Include only the fields you are changing:
{
  "nodes": [...],           // full replacement node array
  "entry_node_id": "...",   // which node is the entry point
  "trigger_type": "...",    // "keyword" | "first_inbound_message" | "manual" | "api_trigger"
  "trigger_config": {...},  // e.g. { "keywords": ["hello", "hi"] }
  "name": "..."             // flow name
}

Example of a minimal "add a node" patch — only nodes and entry_node_id change:
\`\`\`json
{
  "nodes": [...all nodes including the new one...],
  "entry_node_id": "start"
}
\`\`\``

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: flow } = await supabase
    .from('flows')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI not configured — add ANTHROPIC_API_KEY to your environment.' },
      { status: 503 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    message: string
    history: ChatMessage[]
    state: unknown
  } | null

  if (!body?.message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  // Inject current flow state only into the latest user message — history
  // stays clean so it doesn't balloon the context window on long sessions.
  const stateBlock = `## Current flow state\n\`\`\`json\n${JSON.stringify(body.state, null, 2)}\n\`\`\``

  const messages: ChatMessage[] = [
    // Keep last 12 turns to cap context cost.
    ...body.history.slice(-12),
    {
      role: 'user',
      content: `${stateBlock}\n\n${body.message.trim()}`,
    },
  ]

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    return NextResponse.json(
      { error: `Claude API error (${res.status}): ${errText}` },
      { status: 502 },
    )
  }

  const claudeData = (await res.json()) as {
    content: Array<{ type: string; text: string }>
  }
  const fullText =
    claudeData.content.find((c) => c.type === 'text')?.text ?? ''

  // Extract the JSON patch block if the model included one.
  const jsonMatch = fullText.match(/```json\s*([\s\S]*?)```/)
  let patch: Record<string, unknown> | null = null
  let reply = fullText

  if (jsonMatch) {
    try {
      patch = JSON.parse(jsonMatch[1]) as Record<string, unknown>
      // Strip the code block from the displayed reply.
      reply = fullText.replace(/```json\s*[\s\S]*?```/, '').trim()
    } catch {
      // Malformed JSON — show the raw reply, no patch applied.
    }
  }

  return NextResponse.json({ reply, patch })
}
