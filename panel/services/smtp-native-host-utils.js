export const DEFAULT_SMTP_NATIVE_HOST_NAME = 'com.greene.smtp_bridge';

const NATIVE_HOST_PYTHON_SOURCE = [
  '#!/usr/bin/env python3',
  'import json',
  'import re',
  'import smtplib',
  'import ssl',
  'import struct',
  'import sys',
  'from email.message import EmailMessage',
  '',
  "HOST_VERSION = '0.1.0'",
  '',
  'def read_message():',
  '    raw_len = sys.stdin.buffer.read(4)',
  '    if len(raw_len) == 0:',
  '        return None',
  '    if len(raw_len) < 4:',
  '        return None',
  "    msg_len = struct.unpack('<I', raw_len)[0]",
  '    payload = sys.stdin.buffer.read(msg_len)',
  '    if len(payload) < msg_len:',
  '        return None',
  "    return json.loads(payload.decode('utf-8'))",
  '',
  'def write_message(message):',
  "    encoded = json.dumps(message, ensure_ascii=False).encode('utf-8')",
  "    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))",
  '    sys.stdout.buffer.write(encoded)',
  '    sys.stdout.buffer.flush()',
  '',
  'def normalize_list(value, limit):',
  '    if isinstance(value, list):',
  '        source = value',
  '    else:',
  "        source = re.split(r'[;,]', str(value or ''))",
  '    cleaned = []',
  '    seen = set()',
  '    for item in source:',
  "        email = str(item or '').strip()[:220]",
  "        if not email or '@' not in email:",
  '            continue',
  '        key = email.lower()',
  '        if key in seen:',
  '            continue',
  '        seen.add(key)',
  '        cleaned.append(email)',
  '        if len(cleaned) >= limit:',
  '            break',
  '    return cleaned',
  '',
  'def html_to_text(html):',
  "    text = str(html or '')",
  "    text = re.sub(r'<style[\\s\\S]*?</style>', ' ', text, flags=re.IGNORECASE)",
  "    text = re.sub(r'<script[\\s\\S]*?</script>', ' ', text, flags=re.IGNORECASE)",
  "    text = re.sub(r'<br\\s*/?>', '\\n', text, flags=re.IGNORECASE)",
  "    text = re.sub(r'</p>', '\\n\\n', text, flags=re.IGNORECASE)",
  "    text = re.sub(r'</div>', '\\n', text, flags=re.IGNORECASE)",
  "    text = re.sub(r'<[^>]+>', ' ', text)",
  "    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')",
  "    text = text.replace('&quot;', '\"').replace('&#39;', \"'\")",
  "    text = re.sub(r'\\r\\n', '\\n', text)",
  "    text = re.sub(r'[ \\t]+\\n', '\\n', text)",
  "    text = re.sub(r'\\n{3,}', '\\n\\n', text)",
  '    return text.strip()',
  '',
  'def open_smtp_client(host, port, secure_mode):',
  "    mode = str(secure_mode or 'auto').strip().lower()",
  "    if mode == 'true':",
  '        try:',
  '            client = smtplib.SMTP_SSL(host=host, port=port, timeout=30)',
  '            client.ehlo()',
  '            return client',
  '        except ssl.SSLError as exc:',
  "            if 'wrong version number' not in str(exc).lower() or int(port) != 587:",
  '                raise',
  '    client = smtplib.SMTP(host=host, port=port, timeout=30)',
  '    client.ehlo()',
  "    wants_tls = mode in ('auto', 'false', 'true')",
  "    if wants_tls and client.has_extn('starttls'):",
  '        context = ssl.create_default_context()',
  '        client.starttls(context=context)',
  '        client.ehlo()',
  '    return client',
  '',
  'def handle_smtp_send(message):',
  "    smtp = message.get('smtp') if isinstance(message.get('smtp'), dict) else {}",
  "    mail = message.get('mail') if isinstance(message.get('mail'), dict) else {}",
  '',
  "    host = str(smtp.get('host') or '').strip()[:220]",
  "    port = int(smtp.get('port') or 587)",
  "    secure = str(smtp.get('secure') or 'auto').strip()[:12]",
  "    username = str(smtp.get('username') or '').strip()[:220]",
  "    password = str(smtp.get('password') or '').strip()[:220]",
  "    from_addr = str(smtp.get('from') or username).strip()[:220]",
  '',
  "    to_list = normalize_list(mail.get('to'), 20)",
  "    cc_list = normalize_list(mail.get('cc'), 10)",
  "    bcc_list = normalize_list(mail.get('bcc'), 10)",
  "    subject = str(mail.get('subject') or '').strip()[:220]",
  "    text_body = str(mail.get('text') or '').strip()[:4000]",
  "    html_body = str(mail.get('html') or '').strip()[:12000]",
  "    fallback_text = html_to_text(html_body)[:2500]",
  "    body_text = text_body or fallback_text",
  '',
  '    if not host or not username or not password:',
  "        return {'ok': False, 'error': 'Faltan credenciales SMTP (host/username/password).'}",
  '    if not to_list:',
  "        return {'ok': False, 'error': 'Falta destinatario (to).'}",
  '    if not subject:',
  "        return {'ok': False, 'error': 'Falta asunto (subject).'}",
  '    if not body_text and not html_body:',
  "        return {'ok': False, 'error': 'Falta cuerpo (text/html).'}",
  '',
  '    recipients = to_list + cc_list + bcc_list',
  '    client = None',
  '    try:',
  '        client = open_smtp_client(host, port, secure)',
  '        client.login(username, password)',
  '',
  '        msg = EmailMessage()',
  "        msg['From'] = from_addr",
  "        msg['To'] = ', '.join(to_list)",
  '        if cc_list:',
  "            msg['Cc'] = ', '.join(cc_list)",
  "        msg['Subject'] = subject",
  '',
  '        if body_text:',
  '            msg.set_content(body_text)',
  '            if html_body:',
  "                msg.add_alternative(html_body, subtype='html')",
  '        else:',
  "            msg.set_content('[Sin contenido de texto]')",
  "            msg.add_alternative(html_body, subtype='html')",
  '',
  '        client.send_message(msg, from_addr=from_addr, to_addrs=recipients)',
  "        return {'ok': True, 'result': {'sent': True, 'toCount': len(to_list), 'ccCount': len(cc_list), 'bccCount': len(bcc_list), 'subject': subject}}",
  '    except ssl.SSLError as exc:',
  '        message = str(exc)',
  "        if 'wrong version number' in message.lower():",
  "            return {'ok': False, 'error': 'TLS mismatch: usa secure=auto/false con puerto 587, o secure=true con puerto 465.'}",
  "        return {'ok': False, 'error': message}",
  '    except Exception as exc:',
  "        return {'ok': False, 'error': str(exc)}",
  '    finally:',
  '        if client is not None:',
  '            try:',
  '                client.quit()',
  '            except Exception:',
  '                pass',
  '',
  'def handle_ping(message):',
  '    return {',
  "        'ok': True,",
  "        'result': {",
  "            'pong': True,",
  "            'version': HOST_VERSION,",
  "            'capabilities': ['ping', 'smtp.send']",
  '        }',
  '    }',
  '',
  'def handle_message(message):',
  "    msg_type = str(message.get('type') or '').strip().upper()",
  "    if msg_type == 'PING':",
  '        return handle_ping(message)',
  "    if msg_type == 'GREENE_SMTP_SEND':",
  '        return handle_smtp_send(message)',
  "    return {'ok': False, 'error': f'Tipo no soportado: {msg_type}'}",
  '',
  'def main():',
  '    while True:',
  '        message = read_message()',
  '        if message is None:',
  '            break',
  '        try:',
  '            response = handle_message(message)',
  '        except Exception as exc:',
  "            response = {'ok': False, 'error': str(exc)}",
  '        write_message(response)',
  '',
  "if __name__ == '__main__':",
  '    main()'
].join('\n');

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
    '  "description": "Greene Native SMTP Host",',
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
    "  description = 'Greene Native SMTP Host'",
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
