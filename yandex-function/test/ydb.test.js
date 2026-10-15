'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('ydb-sdk');
const { createYdbStore, YQL } = require('../ydb');
const { createMetadataAuth } = require('../metadata');
const env = { ENDPOINT: 'grpcs://example.invalid:2135', DATABASE: '/test/db' };
const row = {
  id: 'uuid',
  created_at: new Date('2026-10-11T00:00:00Z'),
  name: "'; DROP TABLE requests; --",
  contact: '@qa',
  product_name: 'test',
  message: 'question',
  consent: true,
  consent_version: 'v1',
  status: 'new',
};
test('actual SDK typed parameters, metadata provider, auto commit and shared driver', async () => {
  const settings = [],
    queries = [];
  class Driver {
    constructor(config) {
      settings.push(config);
      this.tableClient = {
        withSessionRetry: async (ctx, fn, timeout, retries) => {
          assert.equal(timeout, 5000);
          assert.equal(retries, 2);
          return fn({
            executeQuery: async (...args) => {
              queries.push(args);
              return {
                resultSets: [
                  {
                    columns: [{ name: 'conflicts', type: sdk.TypedValues.uint64(0).type }],
                    rows: [{ items: [sdk.TypedValues.uint64(0).value] }],
                  },
                ],
              };
            },
          });
        },
      };
    }
    async ready(timeout) {
      assert.equal(timeout, 10000);
      return true;
    }
  }
  const store = createYdbStore({ env, sdk: { ...sdk, Driver } });
  assert.deepEqual(await Promise.all([store.insert(row), store.insert(row)]), [true, true]);
  assert.equal(settings.length, 1);
  assert.equal(queries.length, 2);
  assert.equal(typeof settings[0].authService.getAuthMetadata, 'function');
  assert.equal(settings[0].endpoint, env.ENDPOINT);
  assert.equal(settings[0].database, env.DATABASE);
  const [query, params, tx, options] = queries[0];
  assert.equal(query, YQL);
  assert.ok(!query.includes(row.name));
  assert.match(query, /UPSERT INTO requests/);
  assert.match(query, /WHERE \$id NOT IN \(SELECT id FROM requests WHERE id = \$id\)/);
  assert.deepEqual(tx.beginTx, { serializableReadWrite: {} });
  assert.deepEqual(params.$name, sdk.TypedValues.utf8(row.name));
  assert.deepEqual(params.$created_at, sdk.TypedValues.timestamp(row.created_at));
  assert.deepEqual(params.$consent, sdk.TypedValues.bool(true));
  assert.equal(Object.keys(params).length, 9);
  assert.equal(tx.commitTx, true);
  assert.equal(options.operationParams.operationTimeout.seconds, 5);
  for (const method of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    assert.equal(settings[0].logger[method]('never logged'), undefined);
});
test('driver startup failure cleans up and can retry', async () => {
  let created = 0,
    destroyed = 0;
  class Driver {
    constructor() {
      created++;
    }
    async ready() {
      return false;
    }
    async destroy() {
      destroyed++;
    }
  }
  const store = createYdbStore({ env, sdk: { ...sdk, Driver } });
  await assert.rejects(store.insert(row), /YDB_NOT_READY/);
  await assert.rejects(store.insert(row), /YDB_NOT_READY/);
  assert.equal(created, 2);
  assert.equal(destroyed, 2);
});

test('YDB conflict result rejects reuse without overwriting existing record', async () => {
  class Driver {
    async ready() {
      return true;
    }
    tableClient = {
      withSessionRetry: async (ctx, fn) =>
        fn({
          executeQuery: async (query, params, tx) => {
            assert.equal(tx.commitTx, true);
            assert.deepEqual(tx.beginTx, { serializableReadWrite: {} });
            assert.match(query, /SELECT COUNT\(\*\) AS conflicts/);
            assert.match(query, /WHERE \$id NOT IN \(SELECT id FROM requests WHERE id = \$id\)/);
            assert.ok(!query.includes('UPDATE requests'));
            return {
              resultSets: [
                {
                  columns: [{ name: 'conflicts', type: sdk.TypedValues.uint64(1).type }],
                  rows: [{ items: [sdk.TypedValues.uint64(1).value] }],
                },
              ],
            };
          },
        }),
    };
  }
  assert.equal(await createYdbStore({ env, sdk: { ...sdk, Driver } }).insert(row), false);
});
test('metadata-only auth caches, deduplicates, renews tokens with expiry', async () => {
  let time = 0,
    calls = 0;
  const auth = createMetadataAuth({
    sdk,
    clock: () => time,
    fetcher: async (url, init) => {
      calls++;
      assert.equal(
        url,
        'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
      );
      assert.equal(init.headers['Metadata-Flavor'], 'Google');
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json({ access_token: 'TEST_TOKEN_' + calls, expires_in: 100 });
    },
  });
  await Promise.all([auth.getAuthMetadata(), auth.getAuthMetadata()]);
  assert.equal(calls, 1);
  time = 79000;
  await auth.getAuthMetadata();
  assert.equal(calls, 1);
  time = 81000;
  await auth.getAuthMetadata();
  assert.equal(calls, 2);
});
test('metadata errors fail closed and do not poison refresh cache', async () => {
  let calls = 0;
  const auth = createMetadataAuth({
    sdk,
    fetcher: async () => {
      calls++;
      if (calls === 1) throw new Error('network');
      return Response.json({ access_token: 'TEST_TOKEN', expires_in: 100 });
    },
  });
  await assert.rejects(auth.getAuthMetadata());
  await auth.getAuthMetadata();
  assert.equal(calls, 2);
  for (const value of [
    {},
    { access_token: '', expires_in: 100 },
    { access_token: 'TEST_TOKEN', expires_in: 0 },
  ]) {
    const invalid = createMetadataAuth({ sdk, fetcher: async () => Response.json(value) });
    await assert.rejects(invalid.getAuthMetadata());
  }
});
