const READ_ONLY_MAX_ROWS = 200;
const WRITE_RESULT_MAX_ROWS = 80;
const DB_QUERY_MESSAGE_TYPE = 'GREENE_DB_QUERY';

const DEFAULT_DB_BRIDGE_CONFIG = Object.freeze({
  transport: 'http_agent',
  nativeHostName: 'com.greene.smtp_bridge',
  agentUrl: 'http://127.0.0.1:4395/db/query'
});

function toSafeText(value, limit = 6000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  return text.slice(0, limit);
}

function normalizeSqlParams(rawParams, maxParams = 120) {
  if (!Array.isArray(rawParams)) {
    return [];
  }

  return rawParams.slice(0, Math.max(0, Number(maxParams) || 0));
}

function toSingleSqlStatement(rawSql) {
  const source = toSafeText(rawSql, 20000);
  if (!source) {
    throw new Error('SQL vacio.');
  }

  const withoutTrailingSemicolon = source.replace(/;\s*$/, '').trim();
  if (!withoutTrailingSemicolon) {
    throw new Error('SQL vacio.');
  }

  if (withoutTrailingSemicolon.includes(';')) {
    throw new Error('Solo se permite un statement SQL por tool.');
  }

  return withoutTrailingSemicolon;
}

function toSafeReadSql(rawSql) {
  const statement = toSingleSqlStatement(rawSql);
  const head = statement.toLowerCase();
  if (!/^(select|with|show|explain)\b/.test(head)) {
    throw new Error('db.queryRead solo permite SELECT/CTE/SHOW/EXPLAIN.');
  }

  if (
    /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment)\b/i.test(statement)
  ) {
    throw new Error('db.queryRead bloqueo una operacion de escritura o DDL.');
  }

  return statement;
}

function toSafeWriteSql(rawSql, options = {}) {
  const statement = toSingleSqlStatement(rawSql);
  const head = statement.toLowerCase();
  const startsLikeWrite = /^(insert|update|delete|with)\b/.test(head);
  const hasWriteKeyword = /\b(insert|update|delete)\b/i.test(statement);
  const allowFullTableWrite = options && options.allowFullTableWrite === true;

  if (!startsLikeWrite || !hasWriteKeyword) {
    throw new Error('db.queryWrite solo permite INSERT/UPDATE/DELETE.');
  }

  if (/\b(create|alter|drop|truncate|grant|revoke|comment)\b/i.test(statement)) {
    throw new Error('db.queryWrite bloqueo una operacion DDL no permitida.');
  }

  if (!allowFullTableWrite) {
    const hasDelete = /\bdelete\s+from\b/i.test(statement);
    const hasUpdate = /\bupdate\b/i.test(statement);
    const hasWhere = /\bwhere\b/i.test(statement);
    if ((hasDelete || hasUpdate) && !hasWhere) {
      throw new Error('db.queryWrite bloqueo UPDATE/DELETE sin WHERE para evitar escrituras masivas.');
    }
  }

  return statement;
}

function normalizeConnectionUrl(value) {
  const raw = toSafeText(value, 4000);
  if (!raw) {
    return '';
  }

  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return '';
  }

  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    return '';
  }

  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    return '';
  }

  return parsed.toString();
}

function assertConnectionUrl(value) {
  const connectionUrl = normalizeConnectionUrl(value);
  if (!connectionUrl) {
    throw new Error('URL de PostgreSQL invalida. Usa formato postgres:// o postgresql://');
  }

  return connectionUrl;
}

function normalizeDbBridgeTransport(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  return token === 'native_host' ? 'native_host' : 'http_agent';
}

function normalizeDbBridgeConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    transport: normalizeDbBridgeTransport(source.transport || DEFAULT_DB_BRIDGE_CONFIG.transport),
    nativeHostName:
      String(source.nativeHostName || DEFAULT_DB_BRIDGE_CONFIG.nativeHostName || '')
        .trim()
        .slice(0, 180) || DEFAULT_DB_BRIDGE_CONFIG.nativeHostName,
    agentUrl:
      String(source.agentUrl || DEFAULT_DB_BRIDGE_CONFIG.agentUrl || '')
        .trim()
        .slice(0, 500) || DEFAULT_DB_BRIDGE_CONFIG.agentUrl
  };
}

function parseJsonObject(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizeEnumOptions(value, limit = 80) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];

  return source
    .map((item) => toSafeText(item || '', 120))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeForeignKey(value) {
  const source = value && typeof value === 'object' ? value : null;
  if (!source) {
    return null;
  }

  const targetTable = toSafeText(source.target_table || source.targetTable || '', 120);
  const targetColumn = toSafeText(source.target_column || source.targetColumn || '', 120);
  if (!targetTable || !targetColumn) {
    return null;
  }

  const targetSchema = toSafeText(source.target_schema || source.targetSchema || '', 120);
  return {
    targetSchema,
    targetTable,
    targetColumn
  };
}

function normalizeSchemaColumn(rawColumn, index = 0) {
  const column = rawColumn && typeof rawColumn === 'object' ? rawColumn : {};
  const name = toSafeText(column.name || '', 120);
  if (!name) {
    return null;
  }

  const type = toSafeText(column.type || column.udt_name || 'text', 120) || 'text';
  const udtName = toSafeText(column.udt_name || '', 120);
  const enumOptions = normalizeEnumOptions(column.enum_options || column.enumOptions);

  return {
    name,
    type,
    udtName,
    nullable: column.nullable === true || String(column.nullable || '').toUpperCase() === 'YES',
    defaultValue: toSafeText(column.default || column.defaultValue || '', 320),
    ordinal: Math.max(1, Number(column.ordinal_position) || Number(column.ordinal) || index + 1),
    isPrimaryKey: column.is_primary_key === true || column.isPrimaryKey === true,
    isList: column.is_list === true || String(column.is_list || '').toUpperCase() === 'YES',
    enumOptions,
    foreignKey: normalizeForeignKey(column.foreign_key || column.foreignKey)
  };
}

function normalizeSchemaTable(rawTable, maxColumnsPerTable = 120) {
  const source = rawTable && typeof rawTable === 'object' ? rawTable : {};
  const schema = toSafeText(source.schema || source.table_schema || '', 120);
  const name = toSafeText(source.name || source.table_name || source.table || '', 120);
  if (!schema || !name) {
    return null;
  }

  const schemaPayload = parseJsonObject(source.table_schema_json);
  const rawColumns = Array.isArray(source.columns)
    ? source.columns
    : Array.isArray(schemaPayload?.columns)
      ? schemaPayload.columns
      : [];
  const columns = rawColumns
    .map((rawColumn, index) => normalizeSchemaColumn(rawColumn, index))
    .filter(Boolean)
    .sort((left, right) => left.ordinal - right.ordinal)
    .slice(0, maxColumnsPerTable);

  return {
    schema,
    name,
    qualifiedName: `${schema}.${name}`,
    tableType: toSafeText(source.tableType || source.table_type || 'BASE TABLE', 40) || 'BASE TABLE',
    estimatedRows: Number.isFinite(Number(source.estimatedRows ?? source.estimated_rows))
      ? Math.max(0, Math.round(Number(source.estimatedRows ?? source.estimated_rows)))
      : null,
    columns
  };
}

function normalizeSchemaSnapshot(rawSnapshot, options = {}) {
  const source = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
  const maxTables = Math.max(1, Math.min(500, Number(options.maxTables) || 300));
  const maxColumnsPerTable = Math.max(1, Math.min(250, Number(options.maxColumnsPerTable) || 120));
  const tables = (Array.isArray(source.tables) ? source.tables : [])
    .map((rawTable) => normalizeSchemaTable(rawTable, maxColumnsPerTable))
    .filter(Boolean)
    .slice(0, maxTables);

  const schemaCount = new Map();
  for (const table of tables) {
    const known = schemaCount.get(table.schema) || 0;
    schemaCount.set(table.schema, known + 1);
  }
  const fallbackSchemas = Array.from(schemaCount.entries())
    .map(([name, tableCount]) => ({ name, tableCount }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const schemas = (Array.isArray(source.schemas) ? source.schemas : [])
    .map((item) => {
      const row = item && typeof item === 'object' ? item : {};
      const name = toSafeText(row.name || row.schema || '', 120);
      if (!name) {
        return null;
      }
      return {
        name,
        tableCount: Math.max(0, Number(row.tableCount) || Number(row.table_count) || 0)
      };
    })
    .filter(Boolean);

  return {
    analyzedAt: Math.max(0, Number(source.analyzedAt) || Date.now()),
    schemas: schemas.length ? schemas : fallbackSchemas,
    tableCount:
      Math.max(0, Number(source.tableCount) || Number(source.table_count) || 0) || tables.length,
    tables
  };
}

function normalizeReadResult(rawResult, maxRows) {
  const source = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const limitedRows = rows.slice(0, maxRows);
  const rowCount = Math.max(0, Number(source.rowCount) || rows.length);
  const truncated =
    source.truncated === true || rowCount > limitedRows.length || rows.length > limitedRows.length;

  return {
    rowCount,
    truncated,
    rows: limitedRows
  };
}

function normalizeWriteResult(rawResult, maxRows) {
  const source = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const limitedRows = rows.slice(0, maxRows);
  const rowCount = Math.max(0, Number(source.rowCount) || rows.length);
  const truncated =
    source.truncated === true || rowCount > limitedRows.length || rows.length > limitedRows.length;

  return {
    command: toSafeText(source.command || '', 40).toUpperCase() || 'WRITE',
    rowCount,
    truncated,
    rows: limitedRows
  };
}

function runDbBridgeRequest(payload = {}) {
  if (!globalThis?.chrome?.runtime || typeof globalThis.chrome.runtime.sendMessage !== 'function') {
    return Promise.reject(
      new Error('Bridge DB no disponible: runtime de extension no accesible.')
    );
  }

  return new Promise((resolve, reject) => {
    try {
      globalThis.chrome.runtime.sendMessage(
        {
          type: DB_QUERY_MESSAGE_TYPE,
          payload: payload && typeof payload === 'object' ? payload : {}
        },
        (response) => {
          if (globalThis.chrome.runtime.lastError) {
            const runtimeMessage = String(
              globalThis.chrome.runtime.lastError.message ||
                'Error comunicando con background DB bridge.'
            ).trim();
            reject(new Error(runtimeMessage));
            return;
          }

          const safeResponse = response && typeof response === 'object' ? response : null;
          if (!safeResponse || safeResponse.ok !== true) {
            const errorMessage = String(
              safeResponse?.error || 'Error ejecutando DB bridge en background.'
            ).trim();
            reject(new Error(errorMessage));
            return;
          }

          resolve(safeResponse.result);
        }
      );
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error('Error ejecutando DB bridge en background.')
      );
    }
  });
}

export function createPostgresService(options = {}) {
  const cfg = options && typeof options === 'object' ? options : {};
  const resolveBridgeConfig =
    typeof cfg.resolveBridgeConfig === 'function' ? cfg.resolveBridgeConfig : () => null;

  function getBridgeConfig(override) {
    if (override && typeof override === 'object') {
      return normalizeDbBridgeConfig(override);
    }

    try {
      return normalizeDbBridgeConfig(resolveBridgeConfig());
    } catch (_) {
      return normalizeDbBridgeConfig(null);
    }
  }

  async function inspectSchema(connectionUrl, options = {}) {
    const safeConnectionUrl = assertConnectionUrl(connectionUrl);
    const maxTables = Math.max(1, Math.min(500, Number(options.maxTables) || 300));
    const maxColumnsPerTable = Math.max(
      1,
      Math.min(250, Number(options.maxColumnsPerTable) || 120)
    );

    const bridgeResult = await runDbBridgeRequest({
      action: 'inspectSchema',
      connectionUrl: safeConnectionUrl,
      bridge: getBridgeConfig(options.bridge || options.dbBridge),
      options: {
        maxTables,
        maxColumnsPerTable
      }
    });

    return normalizeSchemaSnapshot(bridgeResult, {
      maxTables,
      maxColumnsPerTable
    });
  }

  async function queryRead(connectionUrl, rawSql, rawParams, options = {}) {
    const maxRows = Math.max(1, Math.min(500, Number(options.maxRows) || READ_ONLY_MAX_ROWS));
    const safeConnectionUrl = assertConnectionUrl(connectionUrl);
    const queryText = toSafeReadSql(rawSql);
    const params = normalizeSqlParams(rawParams);

    const bridgeResult = await runDbBridgeRequest({
      action: 'queryRead',
      connectionUrl: safeConnectionUrl,
      sql: queryText,
      params,
      bridge: getBridgeConfig(options.bridge || options.dbBridge),
      options: {
        maxRows
      }
    });

    return normalizeReadResult(bridgeResult, maxRows);
  }

  async function queryWrite(connectionUrl, rawSql, rawParams, options = {}) {
    const maxRows = Math.max(1, Math.min(200, Number(options.maxRows) || WRITE_RESULT_MAX_ROWS));
    const safeConnectionUrl = assertConnectionUrl(connectionUrl);
    const queryText = toSafeWriteSql(rawSql, {
      allowFullTableWrite: options.allowFullTableWrite === true
    });
    const params = normalizeSqlParams(rawParams);

    const bridgeResult = await runDbBridgeRequest({
      action: 'queryWrite',
      connectionUrl: safeConnectionUrl,
      sql: queryText,
      params,
      bridge: getBridgeConfig(options.bridge || options.dbBridge),
      options: {
        maxRows,
        allowFullTableWrite: options.allowFullTableWrite === true
      }
    });

    return normalizeWriteResult(bridgeResult, maxRows);
  }

  return {
    normalizeConnectionUrl,
    isValidConnectionUrl(value) {
      return Boolean(normalizeConnectionUrl(value));
    },
    inspectSchema,
    queryRead,
    queryWrite
  };
}
