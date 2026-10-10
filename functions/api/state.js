const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const database = context => {
  const db = context.env.PASSFLOW_DB;
  if (!db) throw new Error('Shared storage is not configured on this deployment.');
  return db;
};

export async function onRequestGet(context) {
  try {
    const record = await database(context)
      .prepare('SELECT state_json FROM app_state WHERE id = 1')
      .first();
    return json({ state: record ? JSON.parse(record.state_json) : null });
  } catch (error) {
    console.error('Shared state read error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Could not read shared state.' },
      500,
    );
  }
}

export async function onRequestPut(context) {
  try {
    const state = (await context.request.json())?.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return json({ error: 'Invalid shared state.' }, 400);
    }
    const stateJson = JSON.stringify(state);
    if (new TextEncoder().encode(stateJson).byteLength > 900_000) {
      return json({ error: 'Shared state is too large to save.' }, 413);
    }

    await database(context)
      .prepare(
        `INSERT INTO app_state (id, state_json, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .bind(stateJson, new Date().toISOString())
      .run();

    return json({ ok: true });
  } catch (error) {
    console.error('Shared state write error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Could not save shared state.' },
      500,
    );
  }
}
