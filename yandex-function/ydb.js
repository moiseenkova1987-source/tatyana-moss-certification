'use strict';
const { createMetadataAuth } = require('./metadata');

const YQL = `
DECLARE $id AS Utf8;
DECLARE $created_at AS Timestamp;
DECLARE $name AS Utf8;
DECLARE $contact AS Utf8;
DECLARE $product_name AS Utf8;
DECLARE $message AS Utf8;
DECLARE $consent AS Bool;
DECLARE $consent_version AS Utf8;
DECLARE $status AS Utf8;
SELECT COUNT(*) AS conflicts FROM requests
WHERE id = $id AND (
  name != $name OR contact != $contact OR product_name != $product_name OR
  message != $message OR consent != $consent
);
UPSERT INTO requests (id, created_at, name, contact, product_name, message, consent, consent_version, status)
SELECT $id AS id, $created_at AS created_at, $name AS name, $contact AS contact,
  $product_name AS product_name, $message AS message, $consent AS consent,
  $consent_version AS consent_version, $status AS status
WHERE $id NOT IN (SELECT id FROM requests WHERE id = $id);
`;
const silentLogger = Object.freeze(
  Object.fromEntries(
    ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((level) => [level, () => {}]),
  ),
);

function createYdbStore({ env = process.env, sdk = require('ydb-sdk') } = {}) {
  let ready;
  async function driver() {
    if (!ready) {
      ready = (async () => {
        const instance = new sdk.Driver({
          endpoint: env.ENDPOINT,
          database: env.DATABASE,
          authService: createMetadataAuth({ sdk }),
          logger: silentLogger,
          poolSettings: { minLimit: 0, maxLimit: 5 },
        });
        try {
          if (!(await instance.ready(10000))) throw new Error('YDB_NOT_READY');
          return instance;
        } catch {
          await instance.destroy().catch(() => {});
          throw new Error('YDB_NOT_READY');
        }
      })().catch((error) => {
        ready = undefined;
        throw error;
      });
    }
    return ready;
  }
  return {
    async insert(record) {
      const instance = await driver();
      const params = {};
      for (const key of [
        'id',
        'name',
        'contact',
        'product_name',
        'message',
        'consent_version',
        'status',
      ])
        params[`$${key}`] = sdk.TypedValues.utf8(record[key]);
      params.$created_at = sdk.TypedValues.timestamp(record.created_at);
      params.$consent = sdk.TypedValues.bool(record.consent);
      const settings = new sdk.ExecuteQuerySettings().withOperationParams(
        new sdk.OperationParams().withOperationTimeoutSeconds(5).withCancelAfterSeconds(5),
      );
      // Serializable read + conditional insert in one transaction: concurrent
      // retries cannot insert twice or overwrite status, date or consent version.
      const { ctx, dispose } = sdk.Context.createNew({ timeout: 12000 });
      try {
        const result = await ctx.cancelRace(
          instance.tableClient.withSessionRetry(
            ctx,
            (session) => session.executeQuery(YQL, params, sdk.AUTO_TX, settings),
            5000,
            2,
          ),
        );
        const rows = sdk.TypedData.createNativeObjects(result.resultSets[0]);
        if (rows.length !== 1 || rows[0].conflicts == null) throw new Error('YDB_RESULT_INVALID');
        return Number(rows[0].conflicts) === 0;
      } finally {
        dispose?.();
      }
    },
  };
}

module.exports = { createYdbStore, YQL };
