// עטיפה דקה סביב Claude API. כל שלב בצנרת מקבל פונקציית callJSON, כך שבבדיקות
// אפשר להזריק מודל מדומה בלי לגעת בשאר הקוד.
import Anthropic from '@anthropic-ai/sdk';
import { MODEL } from './config.js';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client;
function getClient() {
  client ||= new Anthropic();
  return client;
}

function collectText(message) {
  return message.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function assertUsable(message) {
  if (message.stop_reason === 'refusal') {
    const cat = message.stop_details?.category ?? 'לא ידוע';
    throw new Error(`המודל סירב לבקשה (קטגוריה: ${cat})`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('התשובה נקטעה בגלל מגבלת אורך (max_tokens)');
  }
}

// קריאה שמחזירה JSON לפי סכמה (structured outputs).
// ההנחיה הקבועה ב-system ותיק החומרים (עם cache_control בסופו) זהים בין הסוכנים, כך שרובם נקראים מהמטמון.
export async function callJSON({ system, content, schema, effort = 'high', maxTokens = 32000 }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await getClient().beta.messages.stream(params).finalMessage();
      assertUsable(message);
      return { data: JSON.parse(collectText(message)), usage: message.usage };
    } catch (e) {
      lastErr = e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.BadRequestError) throw e;
      if (e instanceof Anthropic.APIError && e.status && e.status < 500 && e.status !== 429) throw e;
    }
  }
  throw lastErr;
}

// מחקר מתחרים עם חיפוש ברשת. מחזיר טקסט חופשי עם מקורות, שנכנס לתיק החומרים.
export async function callResearch({ system, prompt, effort = 'medium', maxUses = 8 }) {
  const messages = [{ role: 'user', content: prompt }];
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxUses },
  ];
  let message;
  for (let i = 0; i < 6; i++) {
    message = await getClient().beta.messages.stream({
      model: MODEL, max_tokens: 32000, betas: [FALLBACK_BETA], fallbacks: 'default',
      system, messages, tools, output_config: { effort },
    }).finalMessage();
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }
  assertUsable(message);
  const sources = [];
  for (const b of message.content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) sources.push(`${r.title || ''} — ${r.url}`);
    }
  }
  return { text: collectText(message), sources: [...new Set(sources)].slice(0, 30), usage: message.usage };
}
