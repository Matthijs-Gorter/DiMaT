import { describe, expect, it } from 'vitest';
import { readApiJson } from '../src/api-json.js';

describe('readApiJson', () => {
  it('decodes a valid API response', async () => {
    await expect(readApiJson(new Response('{"shareCode":"ABC234"}', { status: 201 }), 'Kaart opslaan'))
      .resolves.toEqual({ shareCode: 'ABC234' });
  });

  it('explains an empty API response with its HTTP status', async () => {
    await expect(readApiJson(new Response(null, { status: 502 }), 'Kaart laden'))
      .rejects.toThrow('Kaart laden: de API antwoordde met HTTP 502');
  });

  it('explains a non-JSON API response without leaking a JSON parser exception', async () => {
    await expect(readApiJson(new Response('<html>proxy error</html>', { status: 502 }), 'Kaart opslaan'))
      .rejects.toThrow('maar niet met JSON: <html>proxy error</html>');
  });
});
