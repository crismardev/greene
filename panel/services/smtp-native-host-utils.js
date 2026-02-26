export const DEFAULT_SMTP_NATIVE_HOST_NAME = 'com.greene.smtp_bridge';

const NATIVE_HOST_PYTHON_SOURCE = String.raw`#!/usr/bin/env python3
import json
import re
import smtplib
import ssl
import struct
import sys
from email.message import EmailMessage

HOST_VERSION = '0.2.0'

try:
    import psycopg  # type: ignore
except Exception:
    psycopg = None

try:
    import psycopg2  # type: ignore
except Exception:
    psycopg2 = None

DB_DRIVER_NAME = 'psycopg' if psycopg is not None else ('psycopg2' if psycopg2 is not None else '')

TABLE_LIST_SQL = """
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
"""

TABLE_ESTIMATE_SQL = """
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
"""

TABLE_COLUMNS_SQL = """
SELECT
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable,
  cols.column_default,
  cols.ordinal_position,
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    WHERE tc.table_schema = cols.table_schema
      AND tc.table_name = cols.table_name
      AND tc.constraint_type = 'PRIMARY KEY'
      AND kcu.column_name = cols.column_name
  ) AS is_primary_key
FROM information_schema.columns cols
WHERE cols.table_schema = %s
  AND cols.table_name = %s
ORDER BY cols.ordinal_position;
"""

def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) == 0:
        return None
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack('<I', raw_len)[0]
    payload = sys.stdin.buffer.read(msg_len)
    if len(payload) < msg_len:
        return None
    return json.loads(payload.decode('utf-8'))

def write_message(message):
    encoded = json.dumps(message, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def to_safe_text(value, limit=1200):
    return str(value or '').strip()[: max(0, int(limit or 0))]

def normalize_connection_url(value):
    token = to_safe_text(value, 4000)
    if not token:
        return ''
    if not re.match(r'^(postgres|postgresql)://', token, flags=re.IGNORECASE):
        return ''
    return token

def normalize_list(value, limit):
    if isinstance(value, list):
        source = value
    else:
        source = re.split(r'[;,]', str(value or ''))
    cleaned = []
    seen = set()
    for item in source:
        email = str(item or '').strip()[:220]
        if not email or '@' not in email:
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(email)
        if len(cleaned) >= limit:
            break
    return cleaned

def html_to_text(html):
    text = str(html or '')
    text = re.sub(r'<style[\s\S]*?</style>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'<script[\s\S]*?</script>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&quot;', '"').replace('&#39;', "'")
    text = re.sub(r'\r\n', '\n', text)
    text = re.sub(r'[ \t]+\n', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def normalize_sql_params(raw_params, max_params=120):
    if not isinstance(raw_params, list):
        return []
    return raw_params[: max(0, int(max_params or 0))]

def to_single_sql_statement(raw_sql):
    source = to_safe_text(raw_sql, 20000)
    if not source:
        raise ValueError('SQL vacio.')
    without_trailing_semicolon = re.sub(r';\s*$', '', source).strip()
    if not without_trailing_semicolon:
        raise ValueError('SQL vacio.')
    if ';' in without_trailing_semicolon:
        raise ValueError('Solo se permite un statement SQL por request.')
    return without_trailing_semicolon

def to_safe_read_sql(raw_sql):
    statement = to_single_sql_statement(raw_sql)
    head = statement.lower()
    if re.match(r'^(select|with|show|explain)\b', head) is None:
        raise ValueError('db.queryRead solo permite SELECT/CTE/SHOW/EXPLAIN.')
    if re.search(r'\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment)\b', statement, flags=re.IGNORECASE):
        raise ValueError('db.queryRead bloqueo una operacion de escritura o DDL.')
    return statement

def to_safe_write_sql(raw_sql, allow_full_table_write=False):
    statement = to_single_sql_statement(raw_sql)
    head = statement.lower()
    starts_like_write = re.match(r'^(insert|update|delete|with)\b', head) is not None
    has_write_keyword = re.search(r'\b(insert|update|delete)\b', statement, flags=re.IGNORECASE) is not None
    if not starts_like_write or not has_write_keyword:
        raise ValueError('db.queryWrite solo permite INSERT/UPDATE/DELETE.')
    if re.search(r'\b(create|alter|drop|truncate|grant|revoke|comment)\b', statement, flags=re.IGNORECASE):
        raise ValueError('db.queryWrite bloqueo una operacion DDL no permitida.')
    if not allow_full_table_write:
        has_delete = re.search(r'\bdelete\s+from\b', statement, flags=re.IGNORECASE) is not None
        has_update = re.search(r'\bupdate\b', statement, flags=re.IGNORECASE) is not None
        has_where = re.search(r'\bwhere\b', statement, flags=re.IGNORECASE) is not None
        if (has_delete or has_update) and not has_where:
            raise ValueError('db.queryWrite bloqueo UPDATE/DELETE sin WHERE para evitar escrituras masivas.')
    return statement

def convert_dollar_params_to_psycopg(sql_text, params):
    values = list(params or [])
    order = []
    pattern = re.compile(r'\$([1-9][0-9]*)')

    def replace_match(match):
        idx = int(match.group(1)) - 1
        order.append(idx)
        return '%s'

    converted_sql = pattern.sub(replace_match, str(sql_text or ''))
    if not order:
        return converted_sql, values

    remapped = []
    for idx in order:
        remapped.append(values[idx] if idx >= 0 and idx < len(values) else None)
    return converted_sql, remapped

def to_json_value(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode('utf-8')
        except Exception:
            return str(value)
    if isinstance(value, memoryview):
        return to_json_value(value.tobytes())
    if isinstance(value, dict):
        output = {}
        for key, inner_value in value.items():
            output[str(key)] = to_json_value(inner_value)
        return output
    if isinstance(value, (list, tuple, set)):
        return [to_json_value(item) for item in list(value)]
    if hasattr(value, 'isoformat'):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return str(value)

def normalize_row_dict(row_dict):
    normalized = {}
    for key, value in row_dict.items():
        normalized[str(key)] = to_json_value(value)
    return normalized

def create_db_connection(connection_url):
    if psycopg is not None:
        return psycopg.connect(connection_url)
    if psycopg2 is not None:
        return psycopg2.connect(connection_url)
    raise RuntimeError("DB bridge requiere driver Python: instala psycopg (pip install 'psycopg[binary]') o psycopg2.")

def execute_query_fetch_rows(connection, sql_text, params=None):
    values = list(params or [])
    cursor = connection.cursor()
    try:
        cursor.execute(sql_text, values)
        status = str(getattr(cursor, 'statusmessage', '') or '')
        row_count = int(getattr(cursor, 'rowcount', 0) or 0)

        if cursor.description is None:
            return [], row_count, status

        columns = [str(column[0]) for column in cursor.description]
        fetched_rows = cursor.fetchall()
        rows = []
        for raw_row in fetched_rows:
            if isinstance(raw_row, dict):
                rows.append(normalize_row_dict(raw_row))
                continue
            row_obj = {}
            for index, key in enumerate(columns):
                raw_value = raw_row[index] if index < len(raw_row) else None
                row_obj[key] = to_json_value(raw_value)
            rows.append(row_obj)
        if row_count < 0:
            row_count = len(rows)
        return rows, row_count, status
    finally:
        cursor.close()

def normalize_max_rows(value, fallback, minimum, maximum):
    try:
        numeric = int(value)
    except Exception:
        numeric = int(fallback)
    return max(int(minimum), min(int(maximum), numeric))

def handle_db_inspect_schema(connection, options):
    max_tables = normalize_max_rows((options or {}).get('maxTables'), 300, 1, 500)
    max_columns_per_table = normalize_max_rows((options or {}).get('maxColumnsPerTable'), 120, 1, 250)

    table_rows, _, _ = execute_query_fetch_rows(connection, TABLE_LIST_SQL, [])
    estimate_rows, _, _ = execute_query_fetch_rows(connection, TABLE_ESTIMATE_SQL, [])

    estimates_by_table = {}
    for row in estimate_rows:
        schema = to_safe_text(row.get('table_schema'), 120)
        table = to_safe_text(row.get('table_name'), 120)
        if not schema or not table:
            continue
        key = f"{schema}.{table}"
        try:
            estimates_by_table[key] = max(0, int(float(row.get('estimated_rows') or 0)))
        except Exception:
            estimates_by_table[key] = 0

    selected_tables = []
    for row in table_rows:
        schema = to_safe_text(row.get('table_schema'), 120)
        table = to_safe_text(row.get('table_name'), 120)
        if not schema or not table:
            continue
        selected_tables.append({
            'schema': schema,
            'name': table,
            'tableType': to_safe_text(row.get('table_type') or 'BASE TABLE', 40) or 'BASE TABLE'
        })
        if len(selected_tables) >= max_tables:
            break

    tables = []
    for table in selected_tables:
        schema_name = table['schema']
        table_name = table['name']
        key = f"{schema_name}.{table_name}"
        column_rows, _, _ = execute_query_fetch_rows(
            connection,
            TABLE_COLUMNS_SQL,
            [schema_name, table_name]
        )

        columns = []
        for column_row in column_rows:
            columns.append({
                'name': to_safe_text(column_row.get('column_name'), 120),
                'type': to_safe_text(column_row.get('data_type') or 'text', 120) or 'text',
                'udt_name': to_safe_text(column_row.get('udt_name'), 120),
                'nullable': str(column_row.get('is_nullable') or '').upper() == 'YES',
                'default': to_safe_text(column_row.get('column_default'), 320),
                'ordinal_position': max(1, int(column_row.get('ordinal_position') or len(columns) + 1)),
                'is_primary_key': bool(column_row.get('is_primary_key') is True),
                'is_list': False,
                'enum_options': [],
                'foreign_key': None
            })
            if len(columns) >= max_columns_per_table:
                break

        tables.append({
            'schema': schema_name,
            'name': table_name,
            'qualifiedName': key,
            'tableType': table['tableType'],
            'estimatedRows': estimates_by_table.get(key),
            'columns': columns
        })

    schema_counter = {}
    for table in tables:
        schema_name = to_safe_text(table.get('schema'), 120)
        if not schema_name:
            continue
        schema_counter[schema_name] = schema_counter.get(schema_name, 0) + 1

    schemas = []
    for schema_name in sorted(schema_counter.keys()):
        schemas.append({
            'name': schema_name,
            'tableCount': schema_counter[schema_name]
        })

    return {
        'ok': True,
        'result': {
            'analyzedAt': int(__import__('time').time() * 1000),
            'schemas': schemas,
            'tableCount': len(tables),
            'tables': tables
        }
    }

def handle_db_query_read(connection, message):
    options = message.get('options') if isinstance(message.get('options'), dict) else {}
    max_rows = normalize_max_rows(options.get('maxRows'), 200, 1, 500)
    sql_text = to_safe_read_sql(message.get('sql'))
    params = normalize_sql_params(message.get('params'), 120)
    converted_sql, converted_params = convert_dollar_params_to_psycopg(sql_text, params)
    rows, row_count, _ = execute_query_fetch_rows(connection, converted_sql, converted_params)
    limited_rows = rows[:max_rows]
    return {
        'ok': True,
        'result': {
            'rowCount': max(0, int(row_count if row_count >= 0 else len(rows))),
            'truncated': len(rows) > len(limited_rows),
            'rows': limited_rows
        }
    }

def handle_db_query_write(connection, message):
    options = message.get('options') if isinstance(message.get('options'), dict) else {}
    max_rows = normalize_max_rows(options.get('maxRows'), 80, 1, 200)
    allow_full_table_write = bool(options.get('allowFullTableWrite') is True)
    sql_text = to_safe_write_sql(message.get('sql'), allow_full_table_write)
    params = normalize_sql_params(message.get('params'), 120)
    converted_sql, converted_params = convert_dollar_params_to_psycopg(sql_text, params)
    rows, row_count, status = execute_query_fetch_rows(connection, converted_sql, converted_params)
    connection.commit()
    command = to_safe_text((status.split(' ')[0] if status else 'WRITE'), 40).upper() or 'WRITE'
    limited_rows = rows[:max_rows]
    return {
        'ok': True,
        'result': {
            'command': command,
            'rowCount': max(0, int(row_count if row_count >= 0 else len(rows))),
            'truncated': len(rows) > len(limited_rows),
            'rows': limited_rows
        }
    }

def handle_db_query(message):
    if not DB_DRIVER_NAME:
        return {
            'ok': False,
            'error': "DB bridge requiere driver Python: instala psycopg (pip install 'psycopg[binary]') o psycopg2."
        }

    action = to_safe_text(message.get('action'), 40)
    connection_url = normalize_connection_url(message.get('connectionUrl'))
    if not connection_url:
        return {'ok': False, 'error': 'URL de PostgreSQL invalida. Usa formato postgres:// o postgresql://'}

    connection = None
    try:
        connection = create_db_connection(connection_url)
        if action == 'inspectSchema':
            return handle_db_inspect_schema(connection, message.get('options'))
        if action == 'queryRead':
            return handle_db_query_read(connection, message)
        if action == 'queryWrite':
            return handle_db_query_write(connection, message)
        return {'ok': False, 'error': f'Accion DB no soportada: {action}'}
    except Exception as exc:
        if connection is not None:
            try:
                connection.rollback()
            except Exception:
                pass
        return {'ok': False, 'error': str(exc)}
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass

def open_smtp_client(host, port, secure_mode):
    mode = str(secure_mode or 'auto').strip().lower()
    if mode == 'true':
        try:
            client = smtplib.SMTP_SSL(host=host, port=port, timeout=30)
            client.ehlo()
            return client
        except ssl.SSLError as exc:
            if 'wrong version number' not in str(exc).lower() or int(port) != 587:
                raise
    client = smtplib.SMTP(host=host, port=port, timeout=30)
    client.ehlo()
    wants_tls = mode in ('auto', 'false', 'true')
    if wants_tls and client.has_extn('starttls'):
        context = ssl.create_default_context()
        client.starttls(context=context)
        client.ehlo()
    return client

def handle_smtp_send(message):
    smtp = message.get('smtp') if isinstance(message.get('smtp'), dict) else {}
    mail = message.get('mail') if isinstance(message.get('mail'), dict) else {}

    host = str(smtp.get('host') or '').strip()[:220]
    port = int(smtp.get('port') or 587)
    secure = str(smtp.get('secure') or 'auto').strip()[:12]
    username = str(smtp.get('username') or '').strip()[:220]
    password = str(smtp.get('password') or '').strip()[:220]
    from_addr = str(smtp.get('from') or username).strip()[:220]

    to_list = normalize_list(mail.get('to'), 20)
    cc_list = normalize_list(mail.get('cc'), 10)
    bcc_list = normalize_list(mail.get('bcc'), 10)
    subject = str(mail.get('subject') or '').strip()[:220]
    text_body = str(mail.get('text') or '').strip()[:4000]
    html_body = str(mail.get('html') or '').strip()[:12000]
    fallback_text = html_to_text(html_body)[:2500]
    body_text = text_body or fallback_text

    if not host or not username or not password:
        return {'ok': False, 'error': 'Faltan credenciales SMTP (host/username/password).'}
    if not to_list:
        return {'ok': False, 'error': 'Falta destinatario (to).'}
    if not subject:
        return {'ok': False, 'error': 'Falta asunto (subject).'}
    if not body_text and not html_body:
        return {'ok': False, 'error': 'Falta cuerpo (text/html).'}

    recipients = to_list + cc_list + bcc_list
    client = None
    try:
        client = open_smtp_client(host, port, secure)
        client.login(username, password)

        msg = EmailMessage()
        msg['From'] = from_addr
        msg['To'] = ', '.join(to_list)
        if cc_list:
            msg['Cc'] = ', '.join(cc_list)
        msg['Subject'] = subject

        if body_text:
            msg.set_content(body_text)
            if html_body:
                msg.add_alternative(html_body, subtype='html')
        else:
            msg.set_content('[Sin contenido de texto]')
            msg.add_alternative(html_body, subtype='html')

        client.send_message(msg, from_addr=from_addr, to_addrs=recipients)
        return {'ok': True, 'result': {'sent': True, 'toCount': len(to_list), 'ccCount': len(cc_list), 'bccCount': len(bcc_list), 'subject': subject}}
    except ssl.SSLError as exc:
        message = str(exc)
        if 'wrong version number' in message.lower():
            return {'ok': False, 'error': 'TLS mismatch: usa secure=auto/false con puerto 587, o secure=true con puerto 465.'}
        return {'ok': False, 'error': message}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
    finally:
        if client is not None:
            try:
                client.quit()
            except Exception:
                pass

def handle_ping(_message):
    capabilities = ['ping', 'smtp.send']
    if DB_DRIVER_NAME:
        capabilities.append('db.query')

    return {
        'ok': True,
        'result': {
            'pong': True,
            'version': HOST_VERSION,
            'dbDriver': DB_DRIVER_NAME,
            'capabilities': capabilities
        }
    }

def handle_message(message):
    msg_type = str(message.get('type') or '').strip().upper()
    if msg_type == 'PING':
        return handle_ping(message)
    if msg_type == 'GREENE_SMTP_SEND':
        return handle_smtp_send(message)
    if msg_type == 'GREENE_DB_QUERY':
        return handle_db_query(message)
    return {'ok': False, 'error': f'Tipo no soportado: {msg_type}'}

def main():
    while True:
        message = read_message()
        if message is None:
            break
        try:
            response = handle_message(message)
        except Exception as exc:
            response = {'ok': False, 'error': str(exc)}
        write_message(response)

if __name__ == '__main__':
    main()
`;

const MAC_NATIVE_HOST_LAUNCHER_SOURCE = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
  'exec /usr/bin/env python3 "$SCRIPT_DIR/host.py"'
].join('\n');

const WINDOWS_NATIVE_HOST_LAUNCHER_SOURCE = [
  '@echo off',
  'setlocal',
  'set "SCRIPT_DIR=%~dp0"',
  'where python >nul 2>&1',
  'if %ERRORLEVEL% EQU 0 (',
  '  python "%SCRIPT_DIR%host.py"',
  '  exit /b',
  ')',
  'where py >nul 2>&1',
  'if %ERRORLEVEL% EQU 0 (',
  '  py -3 "%SCRIPT_DIR%host.py"',
  '  exit /b',
  ')',
  'echo Python 3 no encontrado. Instala Python 3 y vuelve a intentar. 1>&2',
  'exit /b 1'
].join('\n');

export function normalizeEmailList(rawValue, limit = 20) {
  const source = Array.isArray(rawValue) ? rawValue : String(rawValue || '').split(/[;,]/);
  const cleaned = [];
  const seen = new Set();

  for (const item of source) {
    const email = String(item || '').trim().slice(0, 220);
    if (!email || !email.includes('@') || seen.has(email.toLowerCase())) {
      continue;
    }
    seen.add(email.toLowerCase());
    cleaned.push(email);
    if (cleaned.length >= limit) {
      break;
    }
  }

  return cleaned;
}

export function htmlToPlainText(rawHtml) {
  const source = String(rawHtml || '').trim();
  if (!source) {
    return '';
  }

  return source
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeNativeHostNameToken(value, fallback = DEFAULT_SMTP_NATIVE_HOST_NAME) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 180);
  if (!normalized) {
    return fallback;
  }
  return normalized;
}

export function buildMacNativeHostInstallerScript({ extensionId = '', hostName = '' } = {}) {
  const safeExtensionId = String(extensionId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 64);
  const safeHostName = sanitizeNativeHostNameToken(hostName, DEFAULT_SMTP_NATIVE_HOST_NAME);

  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `HOST_NAME="${safeHostName}"`,
    `EXTENSION_ID="${safeExtensionId}"`,
    '',
    'if [[ "$(uname -s)" != "Darwin" ]]; then',
    '  echo "Este instalador solo soporta macOS."',
    '  exit 1',
    'fi',
    '',
    'if [[ -z "$EXTENSION_ID" ]]; then',
    '  echo "Extension ID invalido."',
    '  exit 1',
    'fi',
    '',
    'if ! command -v python3 >/dev/null 2>&1; then',
    '  echo "python3 no encontrado. Instala Python 3 y vuelve a intentar."',
    '  exit 1',
    'fi',
    '',
    'BASE_DIR="$HOME/.greene/native-host/$HOST_NAME"',
    'MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"',
    'HOST_PY="$BASE_DIR/host.py"',
    'LAUNCHER="$BASE_DIR/host.sh"',
    'MANIFEST_FILE="$MANIFEST_DIR/${HOST_NAME}.json"',
    '',
    'mkdir -p "$BASE_DIR" "$MANIFEST_DIR"',
    '',
    "cat > \"$HOST_PY\" <<'PYEOF'",
    NATIVE_HOST_PYTHON_SOURCE,
    'PYEOF',
    '',
    'chmod +x "$HOST_PY"',
    '',
    "cat > \"$LAUNCHER\" <<'SHEOF'",
    MAC_NATIVE_HOST_LAUNCHER_SOURCE,
    'SHEOF',
    '',
    'chmod +x "$LAUNCHER"',
    '',
    'cat > "$MANIFEST_FILE" <<JSONEOF',
    '{',
    `  "name": "${safeHostName}",`,
    '  "description": "Greene Native Bridge Host (SMTP + DB)",',
    '  "path": "$LAUNCHER",',
    '  "type": "stdio",',
    `  "allowed_origins": ["chrome-extension://${safeExtensionId}/"]`,
    '}',
    'JSONEOF',
    '',
    'echo "Instalacion completada: $HOST_NAME"',
    'echo "Manifest: $MANIFEST_FILE"',
    'echo "Regresa a la extension y ejecuta Ping complemento."'
  ].join('\n');
}

export function buildWindowsNativeHostInstallerScript({ extensionId = '', hostName = '' } = {}) {
  const safeExtensionId = String(extensionId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 64);
  const safeHostName = sanitizeNativeHostNameToken(hostName, DEFAULT_SMTP_NATIVE_HOST_NAME);

  return [
    "$ErrorActionPreference = 'Stop'",
    '',
    `$HostName = '${safeHostName}'`,
    `$ExtensionId = '${safeExtensionId}'`,
    '',
    'if ([Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {',
    "  Write-Error 'Este instalador solo soporta Windows.'",
    '  exit 1',
    '}',
    '',
    'if ([string]::IsNullOrWhiteSpace($ExtensionId)) {',
    "  Write-Error 'Extension ID invalido.'",
    '  exit 1',
    '}',
    '',
    '$PythonCmd = Get-Command python -ErrorAction SilentlyContinue',
    '$PyLauncherCmd = Get-Command py -ErrorAction SilentlyContinue',
    'if (-not $PythonCmd -and -not $PyLauncherCmd) {',
    "  Write-Error 'Python 3 no encontrado. Instala Python 3 y vuelve a intentar.'",
    '  exit 1',
    '}',
    '',
    '$BaseDir = Join-Path $env:USERPROFILE ".greene\\native-host\\$HostName"',
    '$HostPy = Join-Path $BaseDir "host.py"',
    '$Launcher = Join-Path $BaseDir "host.cmd"',
    '$ManifestFile = Join-Path $BaseDir "$HostName.json"',
    '',
    'New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null',
    '',
    "$HostPySource = @'",
    NATIVE_HOST_PYTHON_SOURCE,
    "'@",
    'Set-Content -LiteralPath $HostPy -Value $HostPySource -Encoding UTF8',
    '',
    "$LauncherSource = @'",
    WINDOWS_NATIVE_HOST_LAUNCHER_SOURCE,
    "'@",
    'Set-Content -LiteralPath $Launcher -Value $LauncherSource -Encoding ASCII',
    '',
    '$Manifest = @{',
    '  name = $HostName',
    "  description = 'Greene Native Bridge Host (SMTP + DB)'",
    '  path = $Launcher',
    "  type = 'stdio'",
    '  allowed_origins = @("chrome-extension://$ExtensionId/")',
    '}',
    '$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestFile -Encoding UTF8',
    '',
    '& reg.exe add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HostName" /ve /t REG_SZ /d "$ManifestFile" /f | Out-Null',
    '& reg.exe add "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\$HostName" /ve /t REG_SZ /d "$ManifestFile" /f | Out-Null',
    '',
    'Write-Output "Instalacion completada: $HostName"',
    'Write-Output "Manifest: $ManifestFile"',
    'Write-Output "Registro Chrome/Edge actualizado en HKCU."',
    'Write-Output "Regresa a la extension y ejecuta Ping complemento."'
  ].join('\n');
}

export function triggerTextFileDownload(filename, content, mimeType = 'text/plain') {
  const safeName = String(filename || '').trim();
  if (!safeName) {
    throw new Error('Nombre de archivo invalido para descarga.');
  }

  const blob = new Blob([String(content || '')], {
    type: String(mimeType || 'text/plain')
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = safeName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1200);
  }
}
