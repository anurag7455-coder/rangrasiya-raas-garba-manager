import { db, router, json, error, ws, secrets, ai } from '@appdeploy/sdk';
const STATE_TABLE = 'passflow_state';
const SUBS_TABLE = 'passflow_subscriptions';
const STATE_KEY = 'global';
interface StateRecord { key: string; state: Record<string, unknown>; updatedAt: number; }
interface SubscriptionRecord { connectionId: string; entityType: string; entityId: string; createdAt: number; }
async function getStateRecord() { const result = await db.list<StateRecord>(STATE_TABLE, { limit: 20 }); return result.items.filter(item => item.key === STATE_KEY).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null; }
async function notifyState(state: Record<string, unknown>) { const result = await db.list<SubscriptionRecord>(SUBS_TABLE, { limit: 500 }); const ids = result.items.filter(item => item.entityType === 'state' && item.entityId === STATE_KEY && item.connectionId).map(item => item.connectionId); if (ids.length) await ws.send(ids, { entity_type: 'state', entity_id: STATE_KEY, state }); }
const mergeSharedStates = (existing: Record<string, unknown> | null, incoming: Record<string, unknown>) => {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(existing || {}), ...Object.keys(incoming || {})]);
  keys.forEach(key => {
    if (Array.isArray(existing?.[key]) || Array.isArray(incoming?.[key])) {
      const byId = new Map<string, Record<string, unknown>>();
      [...((existing?.[key] as Record<string, unknown>[]) || []), ...((incoming?.[key] as Record<string, unknown>[]) || [])]
        .filter(item => item && typeof item === 'object')
        .forEach(item => {
          const id = String(item.id || JSON.stringify(item));
          byId.set(id, { ...(byId.get(id) || {}), ...item });
        });
      merged[key] = [...byId.values()];
    } else merged[key] = incoming[key] ?? existing?.[key];
  });
  return merged;
};
async function saveState(state: Record<string, unknown>) {
  const existing = await getStateRecord();
  const nextState = { ...state };
  const record = { key: STATE_KEY, state: nextState, updatedAt: Date.now() };
  if (existing) await db.update(STATE_TABLE, [{ id: existing.id, record }]);
  else await db.add(STATE_TABLE, [record]);
  await notifyState(nextState);
}
async function sendWhatsAppPdf(body: Record<string, unknown>) {
  const names = await secrets.listSecretNames();
  if (!names.includes('WHATSAPP_ACCESS_TOKEN') || !names.includes('WHATSAPP_PHONE_NUMBER_ID')) return { configured: false, sent: false };
  const token = await secrets.readSecret('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = await secrets.readSecret('WHATSAPP_PHONE_NUMBER_ID');
  const version = names.includes('WHATSAPP_GRAPH_VERSION') ? await secrets.readSecret('WHATSAPP_GRAPH_VERSION') : 'v23.0';
  const mobile = String(body.mobile || '').replace(/\D/g, '');
  const pdfBase64 = String(body.pdfBase64 || '');
  if (!mobile || !pdfBase64) throw new Error('Mobile number and PDF are required.');
  const bytes = Uint8Array.from(atob(pdfBase64), char => char.charCodeAt(0));
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), String(body.filename || 'Rangrasiya-Passes.pdf'));
  form.append('type', 'application/pdf');
  const mediaResponse = await fetch('https://graph.facebook.com/' + version + '/' + phoneNumberId + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
  const media = await mediaResponse.json();
  if (!mediaResponse.ok || !media.id) throw new Error(media.error?.message || 'WhatsApp media upload failed.');
  const messageResponse = await fetch('https://graph.facebook.com/' + version + '/' + phoneNumberId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: mobile, type: 'document', document: { id: media.id, caption: String(body.caption || 'Your Rangrasiya QR passes are attached.'), filename: String(body.filename || 'Rangrasiya-Passes.pdf') } }) });
  const message = await messageResponse.json();
  if (!messageResponse.ok) throw new Error(message.error?.message || 'WhatsApp message send failed.');
  return { configured: true, sent: true, messageId: message.messages?.[0]?.id || null };
}
export const handler = router({
  'GET /api/state': [async () => { const record = await getStateRecord(); return json({ state: record?.state || null, updatedAt: record?.updatedAt || null }); }],
  'PUT /api/state': [async ({ body }) => { const payload = body as { state?: unknown }; if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) return error('Invalid state payload.', 400); await saveState(payload.state as Record<string, unknown>); return json({ ok: true }); }],
  'POST /api/subscriptions': [async ({ body }) => { const payload = body as { connection_id?: string; entity_type?: string; entity_id?: string }; const connectionId = String(payload.connection_id || ''); const entityType = String(payload.entity_type || ''); const entityId = String(payload.entity_id || ''); if (!connectionId || !entityType || !entityId) return error('Invalid subscription.', 400); await db.add(SUBS_TABLE, [{ connectionId, entityType, entityId, createdAt: Date.now() }]); return json({ ok: true }); }],
  'POST /api/ocr/students': [async ({ body }) => {
    try {
      const payload = body as {
        images?: Array<{ data?: string; mimeType?: string }>;
      };
      const images = (payload.images || [])
        .filter(item => item && item.data && item.mimeType)
        .slice(0, 5)
        .map(item => ({ data: String(item.data), mimeType: String(item.mimeType) }));
      if (!images.length) return error('At least one screenshot image is required.', 400);
      const result = await ai.ocr({
        images,
        thinkingMode: 'FAST',
        maxRetries: 1,
        maxTokens: 4096,
        temperature: 0,
        prompt: 'Read the student list table in the screenshot. Extract only rows that visibly contain a student name and/or mobile number. Preserve the visible name spelling as closely as possible. Return mobile numbers as digits only. Never invent missing digits or names. Ignore serial numbers and blank rows.',
        schema: {
          type: 'object',
          properties: {
            students: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  mobile: { type: 'string' },
                },
                required: ['name', 'mobile'],
              },
            },
          },
          required: ['students'],
        },
      });
      const data = result.data as { students?: Array<{ name?: unknown; mobile?: unknown }> } | undefined;
      const students = Array.isArray(data?.students)
        ? data.students.map(item => ({
            name: String(item?.name || '').trim(),
            mobile: String(item?.mobile || '').replace(/\D/g, ''),
          }))
        : [];
      return json({ students });
    } catch (e) {
      console.error('Student screenshot OCR error:', e);
      return error(e instanceof Error ? e.message : 'Student screenshot OCR failed.', 502);
    }
  }],
  'GET /api/whatsapp/status': [async () => { const names = await secrets.listSecretNames(); return json({ configured: names.includes('WHATSAPP_ACCESS_TOKEN') && names.includes('WHATSAPP_PHONE_NUMBER_ID') }); }],
  'POST /api/whatsapp/send-pdf': [async ({ body }) => { try { return json(await sendWhatsAppPdf(body as Record<string, unknown>)); } catch (e) { console.error('WhatsApp PDF error:', e); return error(e instanceof Error ? e.message : 'WhatsApp PDF delivery failed.', 502); } }],
});