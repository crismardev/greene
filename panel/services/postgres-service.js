import { neon } from '../../node_modules/@neondatabase/serverless/index.mjs';

const READ_ONLY_MAX_ROWS = 200;
const WRITE_RESULT_MAX_ROWS = 80;

const TABLE_LIST_SQL = `
SELECT
  t.table_schema,
  t.table_name,
  t.table_type
FROM information_schema.tables t
WHERE t.table_type IN ('BASE TABLE', 'VIEW')
  AND t.table_schema NOT IN ('information_schema', 'pg_catalog')
  AND t.table_schema NOT LIKE 'pg_toast%'
  AND t.table_schema NOT LIKE 'pg_temp_%'
ORDER BY t.table_schema, t.table_name;
`;

const TABLE_SCHEMA_JSON_SQL = `
SELECT json_build_object(
    'table', $2::text,
    'schema', $1::text,
    'columns', COALESCE(
      json_agg(
        json_build_object(
            'name', column_info.column_name,
            'type', column_info.data_type,
            'udt_name', column_info.udt_name,
            'is_list', column_info.is_list,
            'enum_options', CASE
                                WHEN column_info.enum_values IS NOT NULL
                                THEN string_to_array(column_info.enum_values, ', ')
                                ELSE NULL
                            END,
            'foreign_key', CASE
                                WHEN column_info.foreign_table IS NOT NULL
                                THEN json_build_object(
                                    'target_schema', column_info.foreign_schema,
                                    'target_table', column_info.foreign_table,
                                    'target_column', column_info.foreign_column
                                )
                                ELSE NULL
                            END,
            'nullable', column_info.is_nullable,
            'default', column_info.column_default,
            'is_primary_key', column_info.is_primary_key
        )
        ORDER BY column_info.ordinal_position
      ),
      '[]'::json
    )
) AS table_schema_json
FROM (
    SELECT
        cols.column_name,
        cols.data_type,
        cols.udt_name,
        cols.is_nullable,
        cols.column_default,
        cols.ordinal_position,
        (
          SELECT string_agg(enumlabel, ', ' ORDER BY enumsortorder)
          FROM pg_enum
          JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
          WHERE pg_type.typname = CASE
            WHEN LEFT(cols.udt_name, 1) = '_' THEN SUBSTRING(cols.udt_name FROM 2)
            ELSE cols.udt_name
          END
        ) AS enum_values,
        CASE WHEN LEFT(cols.udt_name, 1) = '_' THEN 'YES' ELSE 'NO' END AS is_list,
        fk.foreign_schema,
        fk.foreign_table,
        fk.foreign_column,
        COALESCE(pk.is_primary_key, false) AS is_primary_key
    FROM information_schema.columns cols
    LEFT JOIN (
        SELECT
            kcu.column_name,
            ccu.table_schema AS foreign_schema,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column
        FROM information_schema.key_column_usage AS kcu
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = kcu.constraint_name
         AND ccu.constraint_schema = kcu.constraint_schema
        WHERE kcu.table_schema = $1
          AND kcu.table_name = $2
    ) fk ON cols.column_name = fk.column_name
    LEFT JOIN (
        SELECT
            kcu.column_name,
            true AS is_primary_key
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.constraint_schema = kcu.constraint_schema
        WHERE tc.table_schema = $1
          AND tc.table_name = $2
          AND tc.constraint_type = 'PRIMARY KEY'
    ) pk ON cols.column_name = pk.column_name
    WHERE cols.table_name = $2
      AND cols.table_schema = $1
) column_info;
`;

const TABLE_ESTIMATE_SQL = `
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  c.reltuples::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('information_schema', 'pg_catalog')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname;
`;

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
    /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment)\b/i.test(
      statement
    )
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

function createSqlClient(connectionUrl) {
  return neon(assertConnectionUrl(connectionUrl), {
    fetchOptions: {
      cache: 'no-store'
    }
  });
}

function normalizeTableRow(rawRow) {
  const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
  const schema = toSafeText(row.table_schema || '', 120);
  const table = toSafeText(row.table_name || '', 120);
  if (!schema || !table) {
    return null;
  }

  return {
    schema,
    name: table,
    tableType: toSafeText(row.table_type || 'BASE TABLE', 40) || 'BASE TABLE'
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
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

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
    nullable:
      column.nullable === true || String(column.nullable || '').toUpperCase() === 'YES',
    defaultValue: toSafeText(column.default || column.defaultValue || '', 320),
    ordinal: Math.max(1, Number(column.ordinal_position) || Number(column.ordinal) || index + 1),
    isPrimaryKey: column.is_primary_key === true || column.isPrimaryKey === true,
    isList: column.is_list === true || String(column.is_list || '').toUpperCase() === 'YES',
    enumOptions,
    foreignKey: normalizeForeignKey(column.foreign_key || column.foreignKey)
  };
}

function normalizeTableSchemaPayload(rawPayload, fallbackSchema, fallbackTable) {
  const payload = parseJsonObject(rawPayload);
  if (!payload) {
    return {
      schema: fallbackSchema,
      table: fallbackTable,
      columns: []
    };
  }

  const schema = toSafeText(payload.schema || fallbackSchema || '', 120) || fallbackSchema;
  const table = toSafeText(payload.table || fallbackTable || '', 120) || fallbackTable;
  const rawColumns = Array.isArray(payload.columns) ? payload.columns : [];

  return {
    schema,
    table,
    columns: rawColumns
  };
}

export function createPostgresService() {
  async function inspectSchema(connectionUrl, options = {}) {
    const maxTables = Math.max(1, Math.min(500, Number(options.maxTables) || 300));
    const maxColumnsPerTable = Math.max(
      1,
      Math.min(250, Number(options.maxColumnsPerTable) || 120)
    );

    const sql = createSqlClient(connectionUrl);
    const tableRows = await sql.query(TABLE_LIST_SQL);
    const estimateRows = await sql.query(TABLE_ESTIMATE_SQL);

    const estimatesByTable = new Map();
    for (const rawRow of Array.isArray(estimateRows) ? estimateRows : []) {
      const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
      const schema = toSafeText(row.table_schema || '', 120);
      const table = toSafeText(row.table_name || '', 120);
      if (!schema || !table) {
        continue;
      }

      estimatesByTable.set(`${schema}.${table}`, Math.max(0, Math.round(Number(row.estimated_rows) || 0)));
    }

    const selectedTables = (Array.isArray(tableRows) ? tableRows : [])
      .map((rawRow) => normalizeTableRow(rawRow))
      .filter(Boolean)
      .slice(0, maxTables);

    const tables = [];
    for (const table of selectedTables) {
      const key = `${table.schema}.${table.name}`;
      const schemaRows = await sql.query(TABLE_SCHEMA_JSON_SQL, [table.schema, table.name]);
      const schemaPayload = normalizeTableSchemaPayload(
        schemaRows?.[0]?.table_schema_json,
        table.schema,
        table.name
      );

      const columns = (Array.isArray(schemaPayload.columns) ? schemaPayload.columns : [])
        .map((rawColumn, index) => normalizeSchemaColumn(rawColumn, index))
        .filter(Boolean)
        .sort((left, right) => left.ordinal - right.ordinal)
        .slice(0, maxColumnsPerTable);

      tables.push({
        schema: table.schema,
        name: table.name,
        qualifiedName: key,
        tableType: table.tableType,
        estimatedRows: estimatesByTable.get(key) ?? null,
        columns
      });
    }

    const schemaCount = new Map();
    for (const table of tables) {
      const count = schemaCount.get(table.schema) || 0;
      schemaCount.set(table.schema, count + 1);
    }

    const schemas = Array.from(schemaCount.entries())
      .map(([name, tableCount]) => ({ name, tableCount }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      analyzedAt: Date.now(),
      schemas,
      tableCount: tables.length,
      tables
    };
  }

  async function queryRead(connectionUrl, rawSql, rawParams, options = {}) {
    const maxRows = Math.max(1, Math.min(500, Number(options.maxRows) || READ_ONLY_MAX_ROWS));
    const sql = createSqlClient(connectionUrl);
    const queryText = toSafeReadSql(rawSql);
    const params = normalizeSqlParams(rawParams);
    const rows = await sql.query(queryText, params);
    const safeRows = Array.isArray(rows) ? rows : [];

    return {
      rowCount: safeRows.length,
      truncated: safeRows.length > maxRows,
      rows: safeRows.slice(0, maxRows)
    };
  }

  async function queryWrite(connectionUrl, rawSql, rawParams, options = {}) {
    const maxRows = Math.max(1, Math.min(200, Number(options.maxRows) || WRITE_RESULT_MAX_ROWS));
    const sql = createSqlClient(connectionUrl);
    const queryText = toSafeWriteSql(rawSql, {
      allowFullTableWrite: options.allowFullTableWrite === true
    });
    const params = normalizeSqlParams(rawParams);
    const result = await sql.query(queryText, params, { fullResults: true });

    const outputRows = Array.isArray(result?.rows) ? result.rows : [];
    const rowCount = Math.max(0, Number(result?.rowCount) || outputRows.length);

    return {
      command: toSafeText(result?.command || '', 40).toUpperCase() || 'WRITE',
      rowCount,
      truncated: outputRows.length > maxRows,
      rows: outputRows.slice(0, maxRows)
    };
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
