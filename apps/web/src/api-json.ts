/** Read API JSON without hiding empty or non-JSON proxy/server responses behind Response.json errors. */
export async function readApiJson<T>(response: Response, operation: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`${operation}: de API antwoordde met HTTP ${response.status} (${response.statusText}) en een lege body. Controleer of de server draait op de API-poort en herstart zo nodig de server.`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    const preview = body.replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`${operation}: de API antwoordde met HTTP ${response.status}, maar niet met JSON: ${preview}`);
  }
}
