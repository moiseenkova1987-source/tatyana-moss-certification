'use strict';

const METADATA_URL =
  'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';

// The SDK accepts an async auth service. The token is obtained ONLY from the bound
// service account's metadata endpoint, never from env, a key file or the HTTP event.
function createMetadataAuth({ sdk, fetcher = globalThis.fetch, clock = Date.now }) {
  let cached;
  let refreshAt = 0;
  let pending;
  async function refresh() {
    const response = await fetcher(METADATA_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    if (response.status !== 200) throw new Error('METADATA_UNAVAILABLE');
    const value = await response.json();
    if (
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      typeof value.expires_in !== 'number' ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0
    )
      throw new Error('METADATA_INVALID');
    cached = new sdk.TokenAuthService(value.access_token);
    // Refresh before expiry and at least every 5 minutes; clock works after freezing/thawing.
    refreshAt = clock() + Math.min(value.expires_in * 800, 300000);
    return cached;
  }
  return {
    async getAuthMetadata() {
      if (!cached || clock() >= refreshAt) {
        pending ??= refresh().finally(() => {
          pending = undefined;
        });
        await pending;
      }
      return cached.getAuthMetadata();
    },
  };
}

module.exports = { createMetadataAuth };
