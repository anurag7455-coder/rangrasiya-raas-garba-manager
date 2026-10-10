const STORAGE_KEY = 'passflow-appdeploy-state';
const useHostedApi = import.meta.env.PROD;

async function hostedRequest(path: string, method: string, payload?: unknown) {
  const response = await fetch(path, {
    method,
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }
  return { data };
}

const readSavedState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { events: [], students: [], allocations: [], payments: [], expenses: [] };
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { events: [], students: [], allocations: [], payments: [], expenses: [] };
  } catch (error) {
    console.warn('AppDeploy local storage read failed.', error);
    return { events: [], students: [], allocations: [], payments: [], expenses: [] };
  }
};

const writeSavedState = (state: any) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state || {}));
  } catch (error) {
    console.warn('AppDeploy local storage write failed.', error);
  }
};

export const api = {
  async get(path: string) {
    if (useHostedApi) return hostedRequest(path, 'GET');
    if (path === '/api/state') {
      return { data: { state: readSavedState() } };
    }
    return { data: {} };
  },
  async put(path: string, payload: any) {
    if (useHostedApi) return hostedRequest(path, 'PUT', payload);
    if (path === '/api/state') {
      writeSavedState(payload?.state ?? {});
      return { data: { ok: true } };
    }
    return { data: { ok: true } };
  },
  async post(path: string, payload: any) {
    if (useHostedApi) return hostedRequest(path, 'POST', payload);
    if (path === '/api/subscriptions') {
      return { data: { ok: true } };
    }
    if (path === '/api/ocr/students') {
      return { data: { students: [] } };
    }
    if (path === '/api/whatsapp/send-pdf') {
      return { data: { configured: false, sent: false } };
    }
    return { data: { ok: true } };
  },
};

export const ws = {
  connect() {
    const connection: {
      connectionId: string;
      ready: Promise<void>;
      onMessage: (callback: (message: any) => void) => void;
    } = {
      connectionId: 'local-dev-connection',
      ready: Promise.resolve(),
      onMessage: () => {},
    };

    return {
      ...connection,
      onMessage(callback: (message: any) => void) {
        connection.onMessage = callback;
        return connection;
      },
    };
  },
};

export const image = {
  async resizeIfNeeded(file: File | Blob, options?: { maxDimension?: number; maxPixels?: number; quality?: number; mimeType?: string }) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file as Blob);
    });

    return {
      data: dataUrl,
      mimeType: options?.mimeType || file.type || 'image/jpeg',
    };
  },
};
