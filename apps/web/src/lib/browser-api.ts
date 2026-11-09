const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';
const CONNECTION_MESSAGE = 'We could not reach the server. Check your connection and try again.';

const failureMessage = async (response: Response): Promise<string> => {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? FALLBACK_MESSAGE;
};

export const apiDownload = async (path: string, fileName: string): Promise<string | null> => {
  try {
    const response = await fetch(`/api${path}`);
    if (!response.ok) {
      return await failureMessage(response);
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
    return null;
  } catch {
    return CONNECTION_MESSAGE;
  }
};

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

export const apiSendForJson = async <T,>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> => {
  try {
    const response = await fetch(`/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      return { data: null, error: await failureMessage(response) };
    }
    const text = await response.text();
    return { data: (text ? JSON.parse(text) : null) as T, error: null };
  } catch {
    return { data: null, error: CONNECTION_MESSAGE };
  }
};

export const apiSend = async (
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<string | null> => {
  try {
    const response = await fetch(`/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (response.ok) {
      return null;
    }
    return await failureMessage(response);
  } catch {
    return CONNECTION_MESSAGE;
  }
};
