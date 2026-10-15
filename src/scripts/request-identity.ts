// Only a random ID and a SHA-256 fingerprint are stored, never the form fields.
// The same payload in the same tab (including reloads) is the same logical request.
export async function requestIdentity(endpoint: string, fields: Record<string, string | boolean>) {
  const content = JSON.stringify(
    ['name', 'contact', 'productName', 'message', 'consent', 'website'].map((key) => fields[key]),
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const fingerprint = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  const key = `tm-cert:request:v1:${endpoint}:${fingerprint}`;
  let id = sessionStorage.getItem(key);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    id = crypto.randomUUID();
    // Fail closed if storage is unavailable: do not send without a recoverable ID.
    sessionStorage.setItem(key, id);
  }
  return id;
}
