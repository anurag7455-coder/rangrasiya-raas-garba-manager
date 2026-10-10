const json = data =>
  new Response(JSON.stringify(data), {
    status: 501,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export async function onRequestPost() {
  return json({
    error: 'Screenshot OCR is not configured for this deployment. Import students from Excel or add them manually.',
  });
}
