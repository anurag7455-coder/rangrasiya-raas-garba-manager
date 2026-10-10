const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export async function onRequestPost(context) {
  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId } = context.env;
  if (!token || !phoneNumberId) return json({ configured: false, sent: false });

  try {
    const body = await context.request.json();
    const mobile = String(body?.mobile || '').replace(/\D/g, '');
    const pdfBase64 = String(body?.pdfBase64 || '');
    const filename = String(body?.filename || 'Rangrasiya-Passes.pdf').replace(/[\\/:*?"<>|]/g, '-');
    if (mobile.length < 8 || mobile.length > 15 || !pdfBase64) {
      return json({ error: 'A valid mobile number and PDF are required.' }, 400);
    }
    if (pdfBase64.length > 12_000_000) {
      return json({ error: 'The PDF exceeds the upload limit.' }, 413);
    }

    const bytes = Uint8Array.from(atob(pdfBase64), character => character.charCodeAt(0));
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
    form.append('type', 'application/pdf');

    const version = context.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
    const mediaResponse = await fetch(
      `https://graph.facebook.com/${version}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
    const media = await mediaResponse.json();
    if (!mediaResponse.ok || !media.id) {
      throw new Error(media.error?.message || 'WhatsApp media upload failed.');
    }

    const messageResponse = await fetch(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: mobile,
          type: 'document',
          document: {
            id: media.id,
            caption: String(body?.caption || 'Your Rangrasiya QR passes are attached.'),
            filename,
          },
        }),
      },
    );
    const message = await messageResponse.json();
    if (!messageResponse.ok) {
      throw new Error(message.error?.message || 'WhatsApp message send failed.');
    }

    return json({
      configured: true,
      sent: true,
      messageId: message.messages?.[0]?.id || null,
    });
  } catch (error) {
    console.error('WhatsApp PDF API error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'WhatsApp PDF delivery failed.' },
      502,
    );
  }
}
