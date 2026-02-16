(() => {
  'use strict';

  function createBackgroundSmtpBridgeService(options = {}) {
    const cfg = options && typeof options === 'object' ? options : {};

    const logDebug = typeof cfg.logDebug === 'function' ? cfg.logDebug : () => {};
    const logWarn = typeof cfg.logWarn === 'function' ? cfg.logWarn : () => {};
    const toSafeText =
      typeof cfg.toSafeText === 'function'
        ? cfg.toSafeText
        : (value, limit = 1200) => String(value || '').slice(0, Math.max(0, Number(limit) || 0));
    const parseSafeUrl =
      typeof cfg.parseSafeUrl === 'function'
        ? cfg.parseSafeUrl
        : (value) => {
            const raw = String(value || '').trim();
            if (!raw) {
              return null;
            }
            try {
              return new URL(raw);
            } catch (_) {
              return null;
            }
          };

    const SMTP_HTTP_AGENT_FALLBACK_ENDPOINTS = Object.freeze(
      Array.from(
        new Set(
          (Array.isArray(cfg.smtpHttpAgentFallbackEndpoints)
            ? cfg.smtpHttpAgentFallbackEndpoints
            : ['http://127.0.0.1:4395/smtp/send', 'http://localhost:4395/smtp/send']
          )
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 6)
    );
    const DEFAULT_SMTP_NATIVE_HOST_NAME =
      String(cfg.defaultSmtpNativeHostName || '').trim() || 'com.greene.smtp_bridge';

function normalizeSmtpTransport(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  return token === 'native_host' ? 'native_host' : 'http_agent';
}

function normalizeSmtpSecure(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  if (token === 'auto' || token === 'true' || token === 'false') {
    return token;
  }
  return 'auto';
}

function normalizeEmailList(rawValue, limit = 20) {
  const source = Array.isArray(rawValue) ? rawValue : String(rawValue || '').split(/[;,]/);
  const cleaned = [];
  const seen = new Set();

  for (const item of source) {
    const email = String(item || '').trim().slice(0, 220);
    if (!email || !email.includes('@')) {
      continue;
    }

    const key = email.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    cleaned.push(email);
    if (cleaned.length >= limit) {
      break;
    }
  }

  return cleaned;
}

function htmlToPlainText(rawHtml) {
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

function normalizeSmtpBridgePayload(rawPayload = {}) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const rawSmtp = payload.smtp && typeof payload.smtp === 'object' ? payload.smtp : {};
  const rawMail = payload.mail && typeof payload.mail === 'object' ? payload.mail : {};

  return {
    smtp: {
      transport: normalizeSmtpTransport(rawSmtp.transport),
      nativeHostName: toSafeText(rawSmtp.nativeHostName || DEFAULT_SMTP_NATIVE_HOST_NAME, 180) || DEFAULT_SMTP_NATIVE_HOST_NAME,
      agentUrl: String(rawSmtp.agentUrl || '').trim().slice(0, 500),
      host: String(rawSmtp.host || '').trim().slice(0, 220),
      port: Math.max(1, Math.min(65535, Number(rawSmtp.port) || 587)),
      secure: normalizeSmtpSecure(rawSmtp.secure),
      username: String(rawSmtp.username || '').trim().slice(0, 220),
      password: String(rawSmtp.password || '').trim().slice(0, 220),
      from: String(rawSmtp.from || '').trim().slice(0, 220)
    },
    mail: {
      to: normalizeEmailList(rawMail.to, 20),
      cc: normalizeEmailList(rawMail.cc, 10),
      bcc: normalizeEmailList(rawMail.bcc, 10),
      subject: String(rawMail.subject || '').trim().slice(0, 220),
      text: String(rawMail.text || '').trim().slice(0, 4000),
      html: String(rawMail.html || '').trim().slice(0, 12000)
    }
  };
}

function buildSmtpBridgeLogSummary(normalizedPayload) {
  const safePayload = normalizedPayload && typeof normalizedPayload === 'object' ? normalizedPayload : {};
  const smtp = safePayload.smtp && typeof safePayload.smtp === 'object' ? safePayload.smtp : {};
  const mail = safePayload.mail && typeof safePayload.mail === 'object' ? safePayload.mail : {};

  return {
    transport: normalizeSmtpTransport(smtp.transport),
    nativeHostName: toSafeText(smtp.nativeHostName || '', 160),
    agentUrl: toSafeText(smtp.agentUrl || '', 220),
    host: toSafeText(smtp.host || '', 120),
    port: Math.max(1, Number(smtp.port) || 0),
    secure: normalizeSmtpSecure(smtp.secure),
    from: toSafeText(smtp.from || '', 120),
    toCount: Array.isArray(mail.to) ? mail.to.length : 0,
    ccCount: Array.isArray(mail.cc) ? mail.cc.length : 0,
    bccCount: Array.isArray(mail.bcc) ? mail.bcc.length : 0,
    subject: toSafeText(mail.subject || '', 140),
    hasText: Boolean(String(mail.text || '').trim()),
    hasHtml: Boolean(String(mail.html || '').trim())
  };
}

function sendNativeMessageToHost(nativeHostName, messagePayload = {}) {
  const appName = toSafeText(nativeHostName || '', 180);
  if (!appName) {
    return Promise.reject(new Error('Native Host Name invalido.'));
  }
  if (!chrome?.runtime || typeof chrome.runtime.sendNativeMessage !== 'function') {
    return Promise.reject(new Error('Native messaging no disponible en este entorno.'));
  }

  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(appName, messagePayload, (response) => {
        if (chrome.runtime.lastError) {
          const runtimeMessage = String(chrome.runtime.lastError.message || '').trim();
          if (/native messaging host/i.test(runtimeMessage) && /not found/i.test(runtimeMessage)) {
            reject(
              new Error(
                `Native host '${appName}' no encontrado. Instala y registra el host local en tu sistema antes de usar transport=native_host.`
              )
            );
            return;
          }

          reject(new Error(runtimeMessage || `Error comunicando con Native Host '${appName}'.`));
          return;
        }
        resolve(response && typeof response === 'object' ? response : null);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Error ejecutando Native Host.'));
    }
  });
}

async function runNativeHostPing(rawPayload = {}) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const nativeHostName =
    toSafeText(payload.nativeHostName || DEFAULT_SMTP_NATIVE_HOST_NAME, 180) || DEFAULT_SMTP_NATIVE_HOST_NAME;

  logDebug('native_host_ping:attempt', {
    nativeHostName
  });

  const nativeResponse = await sendNativeMessageToHost(nativeHostName, {
    type: 'PING',
    source: 'greene/background',
    requestedAt: Date.now()
  });

  if (!nativeResponse || nativeResponse.ok !== true) {
    const errorMessage = String(nativeResponse?.error || nativeResponse?.message || 'Native host ping error.').trim();
    logWarn('native_host_ping:error', {
      nativeHostName,
      error: toSafeText(errorMessage, 220)
    });
    throw new Error(errorMessage || 'Native host ping error.');
  }

  const result = nativeResponse.result && typeof nativeResponse.result === 'object' ? nativeResponse.result : {};
  const capabilities = Array.isArray(result.capabilities)
    ? result.capabilities.map((item) => toSafeText(item, 80)).filter(Boolean).slice(0, 20)
    : [];

  const pingResult = {
    pong: result.pong !== false,
    version: toSafeText(result.version || '', 60),
    capabilities,
    hostName: nativeHostName
  };

  logDebug('native_host_ping:success', pingResult);
  return pingResult;
}

function buildHttpAgentConnectionHint(endpoint, errorMessage = '') {
  const safeEndpoint = String(endpoint || '').trim().slice(0, 240);
  const safeError = String(errorMessage || '').trim().slice(0, 220);
  const parsed = parseSafeUrl(safeEndpoint);
  const lowerError = safeError.toLowerCase();

  if (lowerError.includes('failed to fetch')) {
    if (parsed && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
      return `No hay servicio escuchando en ${safeEndpoint}. Inicia tu SMTP agent local o cambia a transport=native_host.`;
    }
    if (parsed && parsed.protocol === 'https:') {
      return `Fallo HTTPS hacia ${safeEndpoint}. Revisa certificado TLS y confianza local del endpoint.`;
    }
  }

  if (!safeEndpoint) {
    return safeError || 'Error de conexion SMTP agent.';
  }

  return safeError ? `${safeEndpoint}: ${safeError}` : `Error de conexion SMTP agent en ${safeEndpoint}.`;
}

async function sendSmtpViaHttpAgent(normalizedPayload) {
  const payload = normalizeSmtpBridgePayload(normalizedPayload);
  const smtp = payload.smtp;
  const mail = payload.mail;
  const candidateEndpoints = Array.from(new Set([smtp.agentUrl, ...SMTP_HTTP_AGENT_FALLBACK_ENDPOINTS]))
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!candidateEndpoints.length) {
    throw new Error('Configura SMTP Agent URL en Settings > Apps & Integrations.');
  }

  const attemptErrors = [];
  for (const endpoint of candidateEndpoints) {
    logDebug('smtp_http_agent:attempt', {
      endpoint: toSafeText(endpoint, 220),
      host: toSafeText(smtp.host, 120),
      port: smtp.port,
      secure: smtp.secure,
      toCount: mail.to.length
    });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          smtp: {
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            username: smtp.username,
            password: smtp.password,
            from: smtp.from
          },
          mail: {
            to: mail.to,
            cc: mail.cc,
            bcc: mail.bcc,
            subject: mail.subject,
            text: mail.text,
            html: mail.html
          }
        })
      });

      let responsePayload = null;
      try {
        responsePayload = await response.json();
      } catch (_) {
        responsePayload = null;
      }

      if (!response.ok) {
        const errorText = String(responsePayload?.error || responsePayload?.message || `HTTP ${response.status}`).trim();
        const errorMessage = `SMTP agent error (${endpoint}): ${errorText}`;
        attemptErrors.push(errorMessage.slice(0, 280));
        logWarn('smtp_http_agent:http_error', {
          endpoint: toSafeText(endpoint, 220),
          status: response.status,
          error: toSafeText(errorText, 220)
        });
        continue;
      }

      logDebug('smtp_http_agent:success', {
        endpoint: toSafeText(endpoint, 220),
        toCount: mail.to.length
      });
      return (
        responsePayload || {
          ok: true,
          endpoint,
          queued: true
        }
      );
    } catch (error) {
      const errorText = error instanceof Error ? error.message : 'Error de conexion SMTP agent.';
      const hinted = buildHttpAgentConnectionHint(endpoint, errorText);
      attemptErrors.push(hinted.slice(0, 300));
      logWarn('smtp_http_agent:network_error', {
        endpoint: toSafeText(endpoint, 220),
        error: toSafeText(errorText, 220),
        hint: toSafeText(hinted, 280)
      });
    }
  }

  const compact = attemptErrors.filter(Boolean).slice(-3).join(' | ');
  throw new Error(compact || 'SMTP agent no disponible.');
}

async function sendSmtpViaNativeHost(normalizedPayload) {
  const payload = normalizeSmtpBridgePayload(normalizedPayload);
  const nativeHostName = String(payload.smtp.nativeHostName || '').trim();
  if (!nativeHostName) {
    throw new Error('Configura Native Host Name en Settings > Apps & Integrations.');
  }

  logDebug('smtp_native_host:attempt', {
    nativeHostName: toSafeText(nativeHostName, 140),
    host: toSafeText(payload.smtp.host, 120),
    port: payload.smtp.port,
    secure: payload.smtp.secure,
    toCount: payload.mail.to.length
  });

  const nativeResponse = await sendNativeMessageToHost(nativeHostName, {
    type: 'GREENE_SMTP_SEND',
    smtp: {
      host: payload.smtp.host,
      port: payload.smtp.port,
      secure: payload.smtp.secure,
      username: payload.smtp.username,
      password: payload.smtp.password,
      from: payload.smtp.from
    },
    mail: payload.mail
  });

  if (!nativeResponse || nativeResponse.ok !== true) {
    const errorMessage = String(nativeResponse?.error || nativeResponse?.message || 'Native host SMTP error.').trim();
    logWarn('smtp_native_host:error', {
      nativeHostName: toSafeText(nativeHostName, 140),
      error: toSafeText(errorMessage, 220)
    });
    throw new Error(errorMessage || 'Native host SMTP error.');
  }

  logDebug('smtp_native_host:success', {
    nativeHostName: toSafeText(nativeHostName, 140),
    toCount: payload.mail.to.length
  });

  return nativeResponse.result || nativeResponse;
}

async function runSmtpBridgeSend(rawPayload = {}) {
  const payload = normalizeSmtpBridgePayload(rawPayload);
  const smtp = payload.smtp;
  const mail = payload.mail;
  const body = (mail.text || htmlToPlainText(mail.html)).slice(0, 2500);

  if (!mail.to.length) {
    throw new Error('smtp.sendMail requiere args.to.');
  }
  if (!mail.subject) {
    throw new Error('smtp.sendMail requiere args.subject.');
  }
  if (!body) {
    throw new Error('smtp.sendMail requiere args.text o args.html.');
  }
  if (!smtp.host || !smtp.username || !smtp.password) {
    throw new Error('Configura SMTP host, username y password en Settings > Apps & Integrations.');
  }

  const normalizedForSend = {
    smtp,
    mail: {
      ...mail,
      text: mail.text || body
    }
  };

  logDebug('smtp_bridge:dispatch', {
    transport: smtp.transport,
    host: toSafeText(smtp.host, 120),
    port: smtp.port,
    secure: smtp.secure,
    agentUrl: toSafeText(smtp.agentUrl, 220),
    nativeHostName: toSafeText(smtp.nativeHostName, 140),
    toCount: mail.to.length
  });

  if (smtp.transport === 'native_host') {
    return sendSmtpViaNativeHost(normalizedForSend);
  }

  return sendSmtpViaHttpAgent(normalizedForSend);
}


    return {
      buildSmtpBridgeLogSummary,
      runNativeHostPing,
      runSmtpBridgeSend
    };
  }

  self.GreeneBackgroundSmtpBridge = {
    createBackgroundSmtpBridgeService
  };
})();
