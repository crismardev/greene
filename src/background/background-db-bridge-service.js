(() => {
  'use strict';

  function createBackgroundDbBridgeService(options = {}) {
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

    const DB_HTTP_AGENT_FALLBACK_ENDPOINTS = Object.freeze(
      Array.from(
        new Set(
          (Array.isArray(cfg.dbHttpAgentFallbackEndpoints)
            ? cfg.dbHttpAgentFallbackEndpoints
            : ['http://127.0.0.1:4395/db/query', 'http://localhost:4395/db/query']
          )
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 6)
    );
    const DEFAULT_DB_NATIVE_HOST_NAME =
      String(cfg.defaultDbNativeHostName || '').trim() || 'com.greene.smtp_bridge';

    function normalizeDbBridgeTransport(value) {
      const token = String(value || '')
        .trim()
        .toLowerCase();
      return token === 'native_host' ? 'native_host' : 'http_agent';
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
        throw new Error('Solo se permite un statement SQL por request.');
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
          throw new Error(
            'db.queryWrite bloqueo UPDATE/DELETE sin WHERE para evitar escrituras masivas.'
          );
        }
      }

      return statement;
    }

    function normalizeSqlParams(rawParams, maxParams = 120) {
      if (!Array.isArray(rawParams)) {
        return [];
      }

      return rawParams.slice(0, Math.max(0, Number(maxParams) || 0));
    }

    function normalizeDbBridgePayload(rawPayload = {}) {
      const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
      const bridge = payload.bridge && typeof payload.bridge === 'object' ? payload.bridge : {};
      const rawOptions = payload.options && typeof payload.options === 'object' ? payload.options : {};
      const action = String(payload.action || '').trim();

      const maxRowsRaw = Number(rawOptions.maxRows);
      const maxRows = Number.isFinite(maxRowsRaw)
        ? Math.max(1, Math.min(5000, Math.round(maxRowsRaw)))
        : undefined;

      return {
        action,
        connectionUrl: normalizeConnectionUrl(payload.connectionUrl || ''),
        sql: String(payload.sql || '').trim(),
        params: normalizeSqlParams(payload.params, 120),
        options: {
          maxRows,
          allowFullTableWrite: rawOptions.allowFullTableWrite === true,
          maxTables: Math.max(1, Math.min(500, Number(rawOptions.maxTables) || 300)),
          maxColumnsPerTable: Math.max(1, Math.min(250, Number(rawOptions.maxColumnsPerTable) || 120))
        },
        bridge: {
          transport: normalizeDbBridgeTransport(bridge.transport),
          nativeHostName:
            toSafeText(bridge.nativeHostName || DEFAULT_DB_NATIVE_HOST_NAME, 180) ||
            DEFAULT_DB_NATIVE_HOST_NAME,
          agentUrl: String(bridge.agentUrl || '').trim().slice(0, 500)
        }
      };
    }

    function buildDbBridgeLogSummary(normalizedPayload) {
      const payload = normalizedPayload && typeof normalizedPayload === 'object' ? normalizedPayload : {};
      const bridge = payload.bridge && typeof payload.bridge === 'object' ? payload.bridge : {};
      const params = Array.isArray(payload.params) ? payload.params : [];
      return {
        action: toSafeText(payload.action || '', 40),
        transport: normalizeDbBridgeTransport(bridge.transport),
        nativeHostName: toSafeText(bridge.nativeHostName || '', 180),
        agentUrl: toSafeText(bridge.agentUrl || '', 220),
        hasConnectionUrl: Boolean(toSafeText(payload.connectionUrl || '', 20)),
        sqlHead: toSafeText(String(payload.sql || '').slice(0, 80), 120),
        paramsCount: params.length,
        maxRows: Number(payload?.options?.maxRows) || null
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
                    `Native host '${appName}' no encontrado. Instala y registra el host local antes de usar transport=native_host.`
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

    function buildHttpAgentConnectionHint(endpoint, errorMessage = '') {
      const safeEndpoint = String(endpoint || '').trim().slice(0, 240);
      const safeError = String(errorMessage || '').trim().slice(0, 220);
      const parsed = parseSafeUrl(safeEndpoint);
      const lowerError = safeError.toLowerCase();

      if (lowerError.includes('failed to fetch')) {
        if (parsed && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
          return `No hay servicio escuchando en ${safeEndpoint}. Inicia tu DB bridge local o cambia a transport=native_host.`;
        }
        if (parsed && parsed.protocol === 'https:') {
          return `Fallo HTTPS hacia ${safeEndpoint}. Revisa certificado TLS y confianza local del endpoint.`;
        }
      }

      if (!safeEndpoint) {
        return safeError || 'Error de conexion DB bridge.';
      }

      return safeError ? `${safeEndpoint}: ${safeError}` : `Error de conexion DB bridge en ${safeEndpoint}.`;
    }

    async function runDbViaHttpAgent(normalizedPayload) {
      const bridge = normalizedPayload.bridge || {};
      const candidateEndpoints = Array.from(
        new Set([String(bridge.agentUrl || '').trim(), ...DB_HTTP_AGENT_FALLBACK_ENDPOINTS])
      )
        .filter(Boolean)
        .slice(0, 4);

      if (!candidateEndpoints.length) {
        throw new Error('Configura DB Bridge URL en Settings > Apps & Integrations.');
      }

      const attemptErrors = [];
      for (const endpoint of candidateEndpoints) {
        logDebug('db_http_agent:attempt', {
          endpoint: toSafeText(endpoint, 220),
          action: toSafeText(normalizedPayload.action || '', 40)
        });

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              type: 'GREENE_DB_QUERY',
              action: normalizedPayload.action,
              connectionUrl: normalizedPayload.connectionUrl,
              sql: normalizedPayload.sql || '',
              params: normalizedPayload.params || [],
              options: normalizedPayload.options || {}
            })
          });

          let responsePayload = null;
          try {
            responsePayload = await response.json();
          } catch (_) {
            responsePayload = null;
          }

          if (!response.ok) {
            const errorText = String(
              responsePayload?.error || responsePayload?.message || `HTTP ${response.status}`
            ).trim();
            const errorMessage = `DB bridge error (${endpoint}): ${errorText}`;
            attemptErrors.push(errorMessage.slice(0, 280));
            logWarn('db_http_agent:http_error', {
              endpoint: toSafeText(endpoint, 220),
              status: response.status,
              error: toSafeText(errorText, 220)
            });
            continue;
          }

          if (responsePayload && responsePayload.ok === false) {
            const errorText = String(
              responsePayload.error || responsePayload.message || 'DB bridge payload error.'
            ).trim();
            attemptErrors.push(errorText.slice(0, 280));
            logWarn('db_http_agent:payload_error', {
              endpoint: toSafeText(endpoint, 220),
              error: toSafeText(errorText, 220)
            });
            continue;
          }

          logDebug('db_http_agent:success', {
            endpoint: toSafeText(endpoint, 220),
            action: toSafeText(normalizedPayload.action || '', 40)
          });

          if (responsePayload && typeof responsePayload === 'object' && responsePayload.ok === true) {
            return responsePayload.result;
          }
          return responsePayload;
        } catch (error) {
          const errorText = error instanceof Error ? error.message : 'Error de conexion DB bridge.';
          const hinted = buildHttpAgentConnectionHint(endpoint, errorText);
          attemptErrors.push(hinted.slice(0, 300));
          logWarn('db_http_agent:network_error', {
            endpoint: toSafeText(endpoint, 220),
            error: toSafeText(errorText, 220),
            hint: toSafeText(hinted, 280)
          });
        }
      }

      const compact = attemptErrors.filter(Boolean).slice(-3).join(' | ');
      throw new Error(compact || 'DB bridge no disponible.');
    }

    async function runDbViaNativeHost(normalizedPayload) {
      const bridge = normalizedPayload.bridge || {};
      const nativeHostName = String(bridge.nativeHostName || '').trim();
      if (!nativeHostName) {
        throw new Error('Configura Native Host Name para DB bridge.');
      }

      logDebug('db_native_host:attempt', {
        nativeHostName: toSafeText(nativeHostName, 140),
        action: toSafeText(normalizedPayload.action || '', 40)
      });

      const nativeResponse = await sendNativeMessageToHost(nativeHostName, {
        type: 'GREENE_DB_QUERY',
        action: normalizedPayload.action,
        connectionUrl: normalizedPayload.connectionUrl,
        sql: normalizedPayload.sql || '',
        params: normalizedPayload.params || [],
        options: normalizedPayload.options || {}
      });

      if (!nativeResponse || nativeResponse.ok !== true) {
        const errorMessage = String(
          nativeResponse?.error || nativeResponse?.message || 'Native host DB bridge error.'
        ).trim();
        logWarn('db_native_host:error', {
          nativeHostName: toSafeText(nativeHostName, 140),
          error: toSafeText(errorMessage, 220)
        });
        throw new Error(errorMessage || 'Native host DB bridge error.');
      }

      logDebug('db_native_host:success', {
        nativeHostName: toSafeText(nativeHostName, 140),
        action: toSafeText(normalizedPayload.action || '', 40)
      });
      return nativeResponse.result;
    }

    async function runDbBridgeQuery(rawPayload = {}) {
      const payload = normalizeDbBridgePayload(rawPayload);
      if (!payload.connectionUrl) {
        throw new Error('URL de PostgreSQL invalida. Usa formato postgres:// o postgresql://');
      }

      if (payload.action === 'inspectSchema') {
        // No SQL statement required for schema inspection.
      } else if (payload.action === 'queryRead') {
        payload.sql = toSafeReadSql(payload.sql || '');
      } else if (payload.action === 'queryWrite') {
        payload.sql = toSafeWriteSql(payload.sql || '', {
          allowFullTableWrite: payload.options.allowFullTableWrite === true
        });
      } else {
        throw new Error('Accion DB bridge no soportada.');
      }

      const summary = buildDbBridgeLogSummary(payload);
      logDebug('db_bridge:dispatch', summary);

      if (payload.bridge.transport === 'native_host') {
        return runDbViaNativeHost(payload);
      }

      return runDbViaHttpAgent(payload);
    }

    return {
      buildDbBridgeLogSummary,
      runDbBridgeQuery
    };
  }

  self.GreeneBackgroundDbBridge = {
    createBackgroundDbBridgeService
  };
})();
