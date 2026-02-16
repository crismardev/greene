export function createDynamicRelationsService(deps = {}) {
  const {
    isWhatsappContext,
    isLikelyUserTableName,
    isCrmErpMeProfileComplete,
    splitQualifiedTableName,
    getCrmErpDatabaseConnectionUrl,
    getCrmErpDatabaseSchemaSnapshot,
    getCrmErpDatabaseMeProfile,
    postgresService,
    logDebug = () => {},
    toSafeLogText = (value, limit = 220) => String(value || '').slice(0, Math.max(0, Number(limit) || 0))
  } = deps;

function toSafeDynamicUiText(value, limit = 220) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, Number(limit) || 0));
}

function normalizePhoneSignal(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 7) {
    return '';
  }
  return digits.slice(0, 20);
}

function extractPhoneFromWhatsappChatId(value) {
  const source = String(value || '').trim();
  if (!source) {
    return '';
  }

  const directWid = source.match(/(?:whatsapp:)?([0-9]{7,})@c\.us/i);
  if (directWid && directWid[1]) {
    return normalizePhoneSignal(directWid[1]);
  }

  const fallbackWid = source.match(/([0-9]{7,})@/);
  if (fallbackWid && fallbackWid[1]) {
    return normalizePhoneSignal(fallbackWid[1]);
  }

  return '';
}

function normalizeEmailSignal(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(token)) {
    return '';
  }
  return token.slice(0, 220);
}

function collectUniqueSignals(values, normalizer, limit = 6) {
  const output = [];
  const seen = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    const normalized = normalizer(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push({
      value: toSafeDynamicUiText(item || normalized, 120),
      normalized
    });
    if (output.length >= Math.max(1, Math.min(20, Number(limit) || 6))) {
      break;
    }
  }
  return output;
}

function extractPhoneSignalsFromText(text, limit = 8) {
  const source = String(text || '');
  if (!source) {
    return [];
  }
  const matches = source.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) || [];
  return collectUniqueSignals(matches, normalizePhoneSignal, limit);
}

function extractEmailSignalsFromText(text, limit = 8) {
  const source = String(text || '');
  if (!source) {
    return [];
  }
  const matches = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return collectUniqueSignals(matches, normalizeEmailSignal, limit);
}

function collectDynamicSignalsFromTab(tabContext) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const details = context.details && typeof context.details === 'object' ? context.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
  const inbox = Array.isArray(details.inbox) ? details.inbox : [];
  const messages = Array.isArray(details.messages) ? details.messages : [];
  const entities = Array.isArray(details.entities) ? details.entities : [];

  const textSources = [
    String(context.title || ''),
    String(context.description || ''),
    String(context.textExcerpt || ''),
    String(currentChat.channelId || ''),
    String(currentChat.key || ''),
    String(currentChat.phone || ''),
    String(currentChat.title || ''),
    entities.join(' ')
  ];

  for (const item of inbox.slice(0, 24)) {
    textSources.push(String(item?.title || ''));
    textSources.push(String(item?.phone || ''));
    textSources.push(String(item?.preview || ''));
  }

  for (const item of messages.slice(-20)) {
    textSources.push(String(item?.text || ''));
    textSources.push(String(item?.transcript || item?.enriched?.transcript || ''));
    textSources.push(String(item?.ocrText || item?.enriched?.ocrText || ''));
  }

  const combined = textSources.filter(Boolean).join('\n');
  const phoneFromWhatsappChannelId = extractPhoneFromWhatsappChatId(currentChat.channelId || currentChat.key || '');
  const phones = collectUniqueSignals(
    [
      phoneFromWhatsappChannelId,
      String(currentChat.phone || ''),
      ...extractPhoneSignalsFromText(combined, 12).map((item) => item.normalized)
    ],
    normalizePhoneSignal,
    8
  );
  const emails = collectUniqueSignals(
    extractEmailSignalsFromText(combined, 12).map((item) => item.normalized),
    normalizeEmailSignal,
    8
  );

  if (isWhatsappContext(context)) {
    logDebug('dynamic_signals:whatsapp_detected', {
      tabId: Number(context.tabId) || -1,
      channelId: toSafeLogText(currentChat.channelId || '', 220),
      chatKey: toSafeLogText(currentChat.key || '', 180),
      chatPhone: toSafeLogText(currentChat.phone || '', 80),
      phoneSignals: phones.map((item) => item?.normalized || ''),
      emailSignals: emails.map((item) => item?.normalized || '')
    });
  }

  return {
    phones,
    emails
  };
}

function quoteSqlIdentifier(value) {
  const safe = String(value || '').trim();
  if (!safe) {
    return '""';
  }
  return `"${safe.replace(/"/g, '""')}"`;
}

function tableTitleFromName(tableName) {
  const tokens = String(tableName || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (!tokens.length) {
    return 'Tabla';
  }
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()).join(' ');
}

function isPhoneColumnName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(phone|telefono|cel|mobile|movil|whatsapp|telefono|tel_?)/.test(token);
}

function isEmailColumnName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(email|correo|mail)/.test(token);
}

function isLabelColumnName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(name|nombre|title|subject|contact|cliente|company|empresa|lead|deal|task|item)/.test(token);
}

function isLikelyIdColumnName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return token === 'id' || token.endsWith('_id') || /(uuid|guid)$/.test(token);
}

function isContactReferenceColumnName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(contact_?id|cliente_?id|customer_?id|client_?id|lead_?id|persona_?id|person_?id)/.test(token);
}

function isContactTableName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(contact|cliente|customer|client|persona|person|lead|prospect)/.test(token);
}

function isSecondLevelRelationTableName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(task|activity|ticket|deal|opportunit|message|note|order|invoice|event|call|meeting)/.test(token);
}

function isOwnerAssignmentColumnName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(owner_?id|assigned_?(to|user)?_?id|assignee_?id|user_?id|employee_?id|agent_?id|sales_?rep_?id|created_?by)/.test(
    token
  );
}

function isSupportControlTableName(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  return /(audit|log|history|meta|metadata|config|setting|permission|role|lookup|catalog|dictionary|enum|mapping|map|xref|bridge|pivot|join|migration|schema|token|session|cache|queue|job|tmp|temp|backup|archive|import|export)/.test(
    token
  );
}

function isLikelyBridgeTable(table) {
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  if (!columns.length || columns.length > 8) {
    return false;
  }
  const fkCount = columns.filter((column) => column?.foreignKey && typeof column.foreignKey === 'object').length;
  const labelCount = columns.filter((column) => isLabelColumnName(column?.name)).length;
  return fkCount >= 2 && labelCount <= 1;
}

function classifyTableRelevanceLevel(table, options = {}) {
  const name = String(table?.name || '').trim().toLowerCase();
  if (!name) {
    return 'low';
  }

  if (isSupportControlTableName(name) || isLikelyBridgeTable(table)) {
    return 'support';
  }
  if (isSecondLevelRelationTableName(name)) {
    return 'high';
  }
  if (isContactTableName(name)) {
    return options.allowContact === true ? 'medium' : 'low';
  }

  return 'medium';
}

function findOwnerAssignmentColumn(table, meProfile = null) {
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  if (!columns.length) {
    return {
      hasOwnerColumn: false,
      ownerColumn: null
    };
  }

  const ownerCandidates = columns.filter((column) => {
    const name = String(column?.name || '').trim();
    if (!name) {
      return false;
    }
    if (isOwnerAssignmentColumnName(name)) {
      return true;
    }
    const fk = column?.foreignKey && typeof column.foreignKey === 'object' ? column.foreignKey : null;
    if (!fk) {
      return false;
    }
    const targetTable = String(fk.targetTable || '').trim();
    if (!targetTable) {
      return false;
    }
    return isLikelyUserTableName(targetTable);
  });

  if (!ownerCandidates.length) {
    return {
      hasOwnerColumn: false,
      ownerColumn: null
    };
  }

  const profile = meProfile && typeof meProfile === 'object' ? meProfile : null;
  if (!isCrmErpMeProfileComplete(profile)) {
    return {
      hasOwnerColumn: true,
      ownerColumn: null
    };
  }

  const target = splitQualifiedTableName(profile.tableQualifiedName);
  const profileIdColumn = String(profile.idColumn || '').trim().toLowerCase();
  const fkMatch = ownerCandidates.find((column) => {
    const fk = column?.foreignKey && typeof column.foreignKey === 'object' ? column.foreignKey : null;
    if (!fk) {
      return false;
    }
    const targetTable = String(fk.targetTable || '').trim().toLowerCase();
    const targetSchema = String(fk.targetSchema || '').trim().toLowerCase();
    const targetColumn = String(fk.targetColumn || '').trim().toLowerCase();
    if (!targetTable) {
      return false;
    }

    const tableMatches = target.table && targetTable === target.table.toLowerCase();
    const schemaMatches = !target.schema || !targetSchema || targetSchema === target.schema.toLowerCase();
    const columnMatches = !profileIdColumn || !targetColumn || targetColumn === profileIdColumn;
    return tableMatches && schemaMatches && columnMatches;
  });
  if (fkMatch) {
    return {
      hasOwnerColumn: true,
      ownerColumn: fkMatch
    };
  }

  const byName = ownerCandidates.find((column) => isOwnerAssignmentColumnName(column?.name)) || ownerCandidates[0];
  return {
    hasOwnerColumn: true,
    ownerColumn: byName || null
  };
}

function normalizeIdSignal(value) {
  const token = String(value || '').trim();
  if (!token) {
    return '';
  }
  return token.slice(0, 220);
}

function sanitizeSqlParamsForLog(rawParams, maxItems = 12) {
  const params = Array.isArray(rawParams) ? rawParams : [];
  return params.map((value) => {
    if (Array.isArray(value)) {
      return value
        .slice(0, Math.max(1, Math.min(80, Number(maxItems) || 12)))
        .map((item) => toSafeLogText(item, 120));
    }
    return toSafeLogText(value, 220);
  });
}

function buildWhatsappDirectSignals(tabContext, fallbackSignals = {}) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const details = context.details && typeof context.details === 'object' ? context.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
  const fallbackPhones = Array.isArray(fallbackSignals?.phones) ? fallbackSignals.phones : [];
  const fallbackEmails = Array.isArray(fallbackSignals?.emails) ? fallbackSignals.emails : [];
  const phoneFromChannel = extractPhoneFromWhatsappChatId(currentChat.channelId || currentChat.key || '');
  const primaryPhones = collectUniqueSignals(
    [phoneFromChannel, String(currentChat.phone || ''), String(currentChat.key || '')],
    normalizePhoneSignal,
    4
  );
  const phones = primaryPhones.length ? primaryPhones : fallbackPhones;
  const emails = fallbackEmails.slice(0, 4);

  logDebug('whatsapp_contact:signals', {
    tabId: Number(context.tabId) || -1,
    channelId: toSafeLogText(currentChat.channelId || '', 200),
    chatKey: toSafeLogText(currentChat.key || '', 180),
    chatPhone: toSafeLogText(currentChat.phone || '', 80),
    directPhones: primaryPhones.map((item) => item?.normalized || ''),
    effectivePhones: phones.map((item) => item?.normalized || ''),
    effectiveEmails: emails.map((item) => item?.normalized || '')
  });

  return {
    phones,
    emails
  };
}

function buildSignalMatchExpression(signalType, matchExpr) {
  const type = String(signalType || '').trim().toLowerCase();
  if (type === 'phone') {
    return `regexp_replace(${matchExpr}, '[^0-9]', '', 'g')`;
  }
  if (type === 'email') {
    return `LOWER(TRIM(${matchExpr}))`;
  }
  return `TRIM(${matchExpr})`;
}

function pickIdColumn(columns) {
  const source = Array.isArray(columns) ? columns : [];
  let best = null;
  let bestScore = -1;
  for (const column of source) {
    const name = String(column?.name || '').trim();
    if (!name) {
      continue;
    }

    let score = 0;
    const token = name.toLowerCase();
    if (column?.isPrimaryKey === true) {
      score += 50;
    }
    if (token === 'id') {
      score += 40;
    }
    if (isContactReferenceColumnName(token)) {
      score += 25;
    }
    if (token.endsWith('_id')) {
      score += 12;
    }
    if (/(uuid|guid)$/.test(token)) {
      score += 4;
    }

    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }

  return best && bestScore > 0 ? best : null;
}

function pickLabelColumn(columns, excludedName = '') {
  const source = Array.isArray(columns) ? columns : [];
  const excludedToken = String(excludedName || '').trim();
  const preferred = source.find((column) => {
    const name = String(column?.name || '').trim();
    return name && name !== excludedToken && isLabelColumnName(name);
  });
  if (preferred) {
    return preferred;
  }

  const fallback = source.find((column) => {
    const name = String(column?.name || '').trim();
    return name && name !== excludedToken && !isLikelyIdColumnName(name);
  });
  return fallback || null;
}

function buildContactAnchorCandidates(snapshot, signals, meProfile = null, limit = 8) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
  const tables = Array.isArray(safeSnapshot?.tables) ? safeSnapshot.tables : [];
  const hasPhoneSignals = Array.isArray(signals?.phones) && signals.phones.length > 0;
  const hasEmailSignals = Array.isArray(signals?.emails) && signals.emails.length > 0;
  if (!hasPhoneSignals && !hasEmailSignals) {
    return [];
  }

  const output = [];
  for (const table of tables) {
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    if (!columns.length) {
      continue;
    }

    const relevanceLevel = classifyTableRelevanceLevel(table, { allowContact: true });
    if (relevanceLevel === 'support') {
      continue;
    }

    const phoneColumns = columns.filter((column) => isPhoneColumnName(column?.name)).slice(0, 6);
    const emailColumns = columns.filter((column) => isEmailColumnName(column?.name)).slice(0, 6);
    if (!phoneColumns.length && !emailColumns.length) {
      continue;
    }

    const idColumn = pickIdColumn(columns);
    if (!idColumn?.name) {
      continue;
    }

    const ownerBinding = findOwnerAssignmentColumn(table, meProfile);

    const labelColumn = pickLabelColumn(columns, idColumn.name) || idColumn;
    const estimatedRows = Number(table?.estimatedRows) || 0;
    const rowScore = estimatedRows > 0 ? Math.max(0, Math.min(18, 18 - Math.log10(estimatedRows + 1) * 4)) : 4;
    const contactBoost = isContactTableName(table?.name) ? 16 : 0;
    const signalBoost = phoneColumns.length && emailColumns.length ? 8 : 4;
    const idBoost = idColumn?.isPrimaryKey === true ? 8 : 3;

    output.push({
      table,
      idColumn,
      labelColumn,
      phoneColumns,
      emailColumns,
      ownerColumn: ownerBinding.ownerColumn || null,
      relevanceLevel,
      priorityHint: Math.round(rowScore + contactBoost + signalBoost + idBoost)
    });
  }

  output.sort((left, right) => right.priorityHint - left.priorityHint);
  return output.slice(0, Math.max(1, Math.min(20, Number(limit) || 8)));
}

async function queryContactMatchesForCandidate(connectionUrl, candidate, signals) {
  const table = candidate?.table && typeof candidate.table === 'object' ? candidate.table : null;
  const idColumn = candidate?.idColumn && typeof candidate.idColumn === 'object' ? candidate.idColumn : null;
  const labelColumn =
    candidate?.labelColumn && typeof candidate.labelColumn === 'object' ? candidate.labelColumn : idColumn;
  const phoneColumns = Array.isArray(candidate?.phoneColumns) ? candidate.phoneColumns : [];
  const emailColumns = Array.isArray(candidate?.emailColumns) ? candidate.emailColumns : [];
  if (!table || !idColumn?.name || !labelColumn?.name) {
    return [];
  }

  const schemaName = String(table.schema || '').trim();
  const tableName = String(table.name || '').trim();
  if (!schemaName || !tableName) {
    return [];
  }

  const phoneValues = (Array.isArray(signals?.phones) ? signals.phones : [])
    .map((item) => item?.normalized || '')
    .map((item) => normalizePhoneSignal(item))
    .filter(Boolean)
    .slice(0, 12);
  const emailValues = (Array.isArray(signals?.emails) ? signals.emails : [])
    .map((item) => item?.normalized || '')
    .map((item) => normalizeEmailSignal(item))
    .filter(Boolean)
    .slice(0, 12);
  if (!phoneValues.length && !emailValues.length) {
    return [];
  }

  const meProfile = getCrmErpDatabaseMeProfile();
  const ownerColumnName = String(candidate?.ownerColumn?.name || '').trim();
  const ownerUserId = isCrmErpMeProfileComplete(meProfile) ? String(meProfile.userId || '').trim() : '';

  const whereTokens = [];
  if (phoneValues.length) {
    for (const column of phoneColumns) {
      const matchExpr = `CAST(${quoteSqlIdentifier(column.name)} AS text)`;
      whereTokens.push(`${buildSignalMatchExpression('phone', matchExpr)} = ANY($1::text[])`);
    }
  }
  if (emailValues.length) {
    for (const column of emailColumns) {
      const matchExpr = `CAST(${quoteSqlIdentifier(column.name)} AS text)`;
      whereTokens.push(`${buildSignalMatchExpression('email', matchExpr)} = ANY($2::text[])`);
    }
  }
  if (!whereTokens.length) {
    return [];
  }

  const qualifiedTable = `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
  const idExpr = `TRIM(CAST(${quoteSqlIdentifier(idColumn.name)} AS text))`;
  const labelExpr = `COALESCE(NULLIF(TRIM(CAST(${quoteSqlIdentifier(
    labelColumn.name
  )} AS text)), ''), NULLIF(${idExpr}, ''), '(sin etiqueta)')`;
  const ownerFilterSql =
    ownerColumnName && ownerUserId
      ? `AND TRIM(CAST(${quoteSqlIdentifier(ownerColumnName)} AS text)) = $3`
      : '';
  const sql = [
    'SELECT item_id, item_label, item_count',
    'FROM (',
    `  SELECT ${idExpr} AS item_id, ${labelExpr} AS item_label, COUNT(*)::int AS item_count`,
    `  FROM ${qualifiedTable}`,
    `  WHERE (${whereTokens.join(' OR ')})`,
    `  ${ownerFilterSql}`,
    '  GROUP BY 1, 2',
    ') grouped',
    "WHERE item_id <> ''",
    'ORDER BY item_count DESC, item_label ASC',
    'LIMIT 12;'
  ].join('\n');

  const params = [phoneValues, emailValues];
  if (ownerFilterSql) {
    params.push(ownerUserId);
  }
  logDebug('whatsapp_contact:lookup_sql', {
    table: `${schemaName}.${tableName}`,
    ownerColumn: ownerColumnName || '',
    ownerFilterActive: Boolean(ownerFilterSql),
    sql,
    params: sanitizeSqlParamsForLog(params)
  });
  const response = await postgresService.queryRead(connectionUrl, sql, params, {
    maxRows: 20
  });
  const rows = Array.isArray(response?.rows) ? response.rows : [];
  logDebug('whatsapp_contact:lookup_result', {
    table: `${schemaName}.${tableName}`,
    rowCount: rows.length,
    preview: rows.slice(0, 5).map((row) => ({
      item_id: toSafeLogText(row?.item_id || '', 80),
      item_label: toSafeLogText(row?.item_label || '', 140),
      item_count: Math.max(0, Number(row?.item_count) || 0)
    }))
  });
  return rows
    .map((row) => {
      const id = normalizeIdSignal(row?.item_id || '');
      if (!id) {
        return null;
      }
      const label = toSafeDynamicUiText(row?.item_label || id, 140) || id;
      const count = Math.max(0, Number(row?.item_count) || 0) || 1;
      return { id, label, count };
    })
    .filter(Boolean);
}

function buildContactSignalEntries(contactRows, limit = 12) {
  const entries = [];
  const seen = new Set();
  for (const row of Array.isArray(contactRows) ? contactRows : []) {
    const id = normalizeIdSignal(row?.id || '');
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label = toSafeDynamicUiText(row?.label || '', 140);
    const value = label ? `${label} (${id})` : id;
    entries.push({
      normalized: id,
      value: toSafeDynamicUiText(value, 180) || id
    });
    if (entries.length >= Math.max(1, Math.min(20, Number(limit) || 12))) {
      break;
    }
  }
  return entries;
}

function buildRelatedTableCandidatesFromContactAnchor(
  snapshot,
  anchorCandidate,
  meProfile = null,
  limit = 12
) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
  const tables = Array.isArray(safeSnapshot?.tables) ? safeSnapshot.tables : [];
  const anchorTable = anchorCandidate?.table && typeof anchorCandidate.table === 'object' ? anchorCandidate.table : null;
  const anchorIdColumn =
    anchorCandidate?.idColumn && typeof anchorCandidate.idColumn === 'object' ? anchorCandidate.idColumn : null;
  if (!anchorTable || !anchorIdColumn?.name) {
    return [];
  }

  const anchorSchema = String(anchorTable.schema || '').trim().toLowerCase();
  const anchorName = String(anchorTable.name || '').trim().toLowerCase();
  const anchorQualified = `${anchorSchema}.${anchorName}`;
  const anchorIdName = String(anchorIdColumn.name || '').trim().toLowerCase();
  const anchorSingular = anchorName.endsWith('s') ? anchorName.slice(0, -1) : anchorName;
  const anchorIdTokens = new Set([
    `${anchorName}_id`,
    `${anchorSingular}_id`,
    `${anchorName}id`,
    `${anchorSingular}id`
  ]);
  if (anchorIdName && anchorIdName !== 'id') {
    anchorIdTokens.add(anchorIdName);
  }

  const output = [];
  for (const table of tables) {
    const schemaName = String(table?.schema || '').trim();
    const tableName = String(table?.name || '').trim();
    if (!schemaName || !tableName) {
      continue;
    }
    if (`${schemaName.toLowerCase()}.${tableName.toLowerCase()}` === anchorQualified) {
      continue;
    }
    if (isContactTableName(tableName)) {
      continue;
    }

    const columns = Array.isArray(table?.columns) ? table.columns : [];
    if (!columns.length) {
      continue;
    }

    const relevanceLevel = classifyTableRelevanceLevel(table);
    if (relevanceLevel === 'support') {
      continue;
    }

    let matchColumn = columns.find((column) => {
      const foreignKey = column?.foreignKey && typeof column.foreignKey === 'object' ? column.foreignKey : null;
      if (!foreignKey) {
        return false;
      }
      const targetTable = String(foreignKey.targetTable || '').trim().toLowerCase();
      const targetSchema = String(foreignKey.targetSchema || '').trim().toLowerCase();
      const targetColumn = String(foreignKey.targetColumn || '').trim().toLowerCase();
      if (!targetTable) {
        return false;
      }
      const schemaMatches = !targetSchema || targetSchema === anchorSchema;
      const tableMatches = targetTable === anchorName;
      const columnMatches = !targetColumn || targetColumn === anchorIdName;
      return schemaMatches && tableMatches && columnMatches;
    });

    if (!matchColumn) {
      matchColumn = columns.find((column) => {
        const name = String(column?.name || '').trim().toLowerCase();
        if (!name) {
          return false;
        }
        if (isContactReferenceColumnName(name)) {
          return true;
        }
        return anchorIdTokens.has(name);
      });
    }

    if (!matchColumn?.name) {
      continue;
    }

    const ownerBinding = findOwnerAssignmentColumn(table, meProfile);

    const labelColumn = pickLabelColumn(columns, matchColumn.name) || matchColumn;
    const estimatedRows = Number(table?.estimatedRows) || 0;
    const rowScore = estimatedRows > 0 ? Math.max(0, Math.min(16, 16 - Math.log10(estimatedRows + 1) * 4)) : 4;
    const fkBoost = matchColumn?.foreignKey ? 12 : 5;
    const nameBoost = isSecondLevelRelationTableName(tableName) ? 10 : 0;
    const relevanceBoost = relevanceLevel === 'high' ? 10 : relevanceLevel === 'medium' ? 4 : 0;

    output.push({
      table,
      matchColumn,
      labelColumn,
      ownerColumn: ownerBinding.ownerColumn || null,
      relevanceLevel,
      priorityHint: Math.round(rowScore + fkBoost + nameBoost + relevanceBoost)
    });
  }

  output.sort((left, right) => right.priorityHint - left.priorityHint);
  return output.slice(0, Math.max(1, Math.min(24, Number(limit) || 12)));
}

async function fetchWhatsappContactFirstRelationCards(connectionUrl, snapshot, tabContext, signals) {
  if (!isWhatsappContext(tabContext)) {
    return [];
  }

  const directSignals = buildWhatsappDirectSignals(tabContext, signals);
  const meProfile = getCrmErpDatabaseMeProfile();
  const anchors = buildContactAnchorCandidates(snapshot, directSignals, meProfile, 10);
  logDebug('whatsapp_contact:anchor_candidates', {
    candidateCount: anchors.length,
    candidates: anchors.slice(0, 8).map((candidate) => ({
      table: toSafeLogText(candidate?.table?.qualifiedName || '', 200),
      idColumn: toSafeLogText(candidate?.idColumn?.name || '', 80),
      ownerColumn: toSafeLogText(candidate?.ownerColumn?.name || '', 80),
      priorityHint: Math.max(0, Number(candidate?.priorityHint) || 0)
    }))
  });
  if (!anchors.length) {
    return [];
  }

  let selectedAnchor = null;
  let matchedContacts = [];
  for (const candidate of anchors) {
    let rows = [];
    try {
      rows = await queryContactMatchesForCandidate(connectionUrl, candidate, directSignals);
      if (!rows.length) {
        rows = await queryContactMatchesForCandidate(connectionUrl, candidate, signals);
      }
    } catch (_) {
      rows = [];
    }
    if (!rows.length) {
      continue;
    }
    selectedAnchor = candidate;
    matchedContacts = rows;
    break;
  }

  if (!selectedAnchor || !matchedContacts.length) {
    return [];
  }

  const contactSignals = buildContactSignalEntries(matchedContacts, 12);
  const contactIds = contactSignals.map((item) => item.normalized).filter(Boolean);
  logDebug('whatsapp_contact:resolved_contact_ids', {
    table: toSafeLogText(selectedAnchor?.table?.qualifiedName || '', 200),
    contactIds: contactIds.slice(0, 12),
    contactSignals: contactSignals.slice(0, 12)
  });
  if (!contactIds.length) {
    return [];
  }

  const cards = [];
  const relatedCandidates = buildRelatedTableCandidatesFromContactAnchor(
    snapshot,
    selectedAnchor,
    meProfile,
    14
  );
  const secondLevelTasks = relatedCandidates.map((candidate) =>
    queryRelationCardForCandidate(connectionUrl, candidate, 'contact_id', contactIds, contactSignals)
  );
  const settled = await Promise.all(secondLevelTasks.map((task) => task.catch(() => null)));
  for (const result of settled) {
    if (!result) {
      continue;
    }
    cards.push(result);
  }

  logDebug('whatsapp_contact:second_level_relations', {
    tableCount: cards.length,
    tables: cards.map((card) => ({
      table: toSafeLogText(card?.tableQualifiedName || '', 200),
      count: Math.max(0, Number(card?.totalCount) || 0),
      caption: toSafeLogText(card?.caption || '', 160)
    }))
  });

  return collapseRelationCardsByTable(cards);
}

function buildRelationTableCandidates(snapshot, signalType, options = {}) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
  const tables = Array.isArray(safeSnapshot?.tables) ? safeSnapshot.tables : [];
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  const excludeContactTables = options.excludeContactTables === true;
  const meProfile = options.meProfile && typeof options.meProfile === 'object' ? options.meProfile : null;
  const output = [];

  for (const table of tables) {
    const tableName = String(table?.name || '').trim();
    if (!tableName) {
      continue;
    }
    if (excludeContactTables && isContactTableName(tableName)) {
      continue;
    }

    const relevanceLevel = classifyTableRelevanceLevel(table, { allowContact: !excludeContactTables });
    if (relevanceLevel === 'support') {
      continue;
    }

    const columns = Array.isArray(table?.columns) ? table.columns : [];
    if (!columns.length) {
      continue;
    }

    const matchColumn =
      signalType === 'phone'
        ? columns.find((column) => isPhoneColumnName(column?.name))
        : columns.find((column) => isEmailColumnName(column?.name));
    if (!matchColumn || !matchColumn.name) {
      continue;
    }

    const ownerBinding = findOwnerAssignmentColumn(table, meProfile);

    let labelColumn = columns.find((column) => {
      const name = String(column?.name || '');
      return name && name !== matchColumn.name && isLabelColumnName(name);
    });
    if (!labelColumn) {
      labelColumn = matchColumn;
    }

    const estimatedRows = Number(table?.estimatedRows) || 0;
    const rowScore = estimatedRows > 0 ? Math.max(0, Math.min(18, 18 - Math.log10(estimatedRows + 1) * 4)) : 4;
    const nameBoost = /(task|deal|lead|contact|customer|client|message|ticket|opportunity|activity)/.test(
      tableName.toLowerCase()
    )
      ? 8
      : 0;
    const relevanceBoost = relevanceLevel === 'high' ? 10 : relevanceLevel === 'medium' ? 4 : 0;

    output.push({
      table,
      matchColumn,
      labelColumn,
      ownerColumn: ownerBinding.ownerColumn || null,
      relevanceLevel,
      priorityHint: Math.round(rowScore + nameBoost + relevanceBoost)
    });
  }

  output.sort((left, right) => right.priorityHint - left.priorityHint);
  return output.slice(0, limit);
}

function fieldLabelFromColumnName(value) {
  const token = String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!token) {
    return 'Field';
  }
  return token
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1).toLowerCase())
    .join(' ');
}

function pickRelationDetailColumns(table, options = {}) {
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  const excluded = new Set(
    [
      String(options.matchColumnName || '').trim().toLowerCase(),
      String(options.labelColumnName || '').trim().toLowerCase(),
      String(options.ownerColumnName || '').trim().toLowerCase()
    ].filter(Boolean)
  );

  const preferredPatterns = [
    /^(status|stage|priority|state)$/,
    /(due|deadline|start|end|date|time)/,
    /(amount|value|total|budget|price)/,
    /(title|name|subject)/,
    /(source|channel|type|category)/
  ];

  const candidates = [];
  for (const column of columns) {
    const rawName = String(column?.name || '').trim();
    const name = rawName.toLowerCase();
    if (!rawName || excluded.has(name)) {
      continue;
    }
    if (isLikelyIdColumnName(name) || isContactReferenceColumnName(name) || isOwnerAssignmentColumnName(name)) {
      continue;
    }

    let score = 0;
    preferredPatterns.forEach((pattern, index) => {
      if (pattern.test(name)) {
        score += Math.max(1, 12 - index * 2);
      }
    });
    if (isLabelColumnName(name)) {
      score += 2;
    }
    if (column?.nullable !== true) {
      score += 1;
    }

    candidates.push({
      name: rawName,
      score
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return candidates.slice(0, 3);
}

async function queryRelationCardForCandidate(connectionUrl, candidate, signalType, normalizedValues, sourceSignals) {
  const table = candidate?.table && typeof candidate.table === 'object' ? candidate.table : null;
  const matchColumn = candidate?.matchColumn && typeof candidate.matchColumn === 'object' ? candidate.matchColumn : null;
  const labelColumn = candidate?.labelColumn && typeof candidate.labelColumn === 'object' ? candidate.labelColumn : null;
  if (!table || !matchColumn?.name || !labelColumn?.name) {
    return null;
  }

  const schemaName = String(table.schema || '').trim();
  const tableName = String(table.name || '').trim();
  if (!schemaName || !tableName) {
    return null;
  }

  const normalizedSignals = (Array.isArray(normalizedValues) ? normalizedValues : [])
    .map((item) =>
      signalType === 'phone'
        ? normalizePhoneSignal(item)
        : signalType === 'email'
          ? normalizeEmailSignal(item)
          : normalizeIdSignal(item)
    )
    .filter(Boolean)
    .slice(0, 12);
  if (!normalizedSignals.length) {
    return null;
  }

  const ownerColumnName = String(candidate?.ownerColumn?.name || '').trim();
  const meProfile = getCrmErpDatabaseMeProfile();
  const ownerUserId = isCrmErpMeProfileComplete(meProfile) ? String(meProfile.userId || '').trim() : '';

  const qualifiedTable = `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
  const matchExpr = `CAST(${quoteSqlIdentifier(matchColumn.name)} AS text)`;
  const normalizedExpr = buildSignalMatchExpression(signalType, matchExpr);
  const labelExprRaw = `CAST(${quoteSqlIdentifier(labelColumn.name)} AS text)`;
  const labelExpr = `COALESCE(NULLIF(TRIM(${labelExprRaw}), ''), NULLIF(TRIM(${matchExpr}), ''), '(sin etiqueta)')`;
  const whereClauses = [`${normalizedExpr} = ANY($1::text[])`];
  const params = [normalizedSignals];
  if (ownerColumnName && ownerUserId) {
    params.push(ownerUserId);
    whereClauses.push(`TRIM(CAST(${quoteSqlIdentifier(ownerColumnName)} AS text)) = $${params.length}`);
  }
  const whereSql = whereClauses.join(' AND ');
  const sql = [
    'SELECT item_label, item_count, SUM(item_count) OVER()::int AS total_count',
    'FROM (',
    `  SELECT ${labelExpr} AS item_label, COUNT(*)::int AS item_count`,
    `  FROM ${qualifiedTable}`,
    `  WHERE ${whereSql}`,
    '  GROUP BY 1',
    ') grouped',
    'ORDER BY item_count DESC, item_label ASC',
    'LIMIT 4;'
  ].join('\n');

  logDebug('dynamic_relations:query_sql', {
    table: `${schemaName}.${tableName}`,
    signalType,
    ownerColumn: ownerColumnName || '',
    ownerFilterActive: Boolean(ownerColumnName && ownerUserId),
    sql,
    params: sanitizeSqlParamsForLog(params)
  });
  const response = await postgresService.queryRead(connectionUrl, sql, params, {
    maxRows: 4
  });
  const rows = Array.isArray(response?.rows) ? response.rows : [];
  logDebug('dynamic_relations:query_result', {
    table: `${schemaName}.${tableName}`,
    signalType,
    rowCount: rows.length,
    preview: rows.slice(0, 4).map((row) => ({
      label: toSafeLogText(row?.item_label || '', 120),
      count: Math.max(0, Number(row?.item_count) || 0),
      total: Math.max(0, Number(row?.total_count) || 0)
    }))
  });
  if (!rows.length) {
    return null;
  }

  const relationRows = rows
    .map((row) => {
      const label = toSafeDynamicUiText(row?.item_label || '', 120) || '(sin etiqueta)';
      const count = Math.max(0, Number(row?.item_count) || 0);
      if (!count) {
        return null;
      }
      return { label, count };
    })
    .filter(Boolean)
    .slice(0, 3);

  if (!relationRows.length) {
    return null;
  }

  const totalCount =
    Math.max(0, Number(rows[0]?.total_count) || 0) || relationRows.reduce((sum, row) => sum + row.count, 0);
  const isSingleResult = totalCount === 1;
  const detailColumns = isSingleResult
    ? pickRelationDetailColumns(table, {
        matchColumnName: matchColumn.name,
        labelColumnName: labelColumn.name,
        ownerColumnName
      })
    : [];
  let detailFields = [];
  if (isSingleResult && detailColumns.length) {
    const detailSelect = detailColumns
      .map(
        (column) =>
          `NULLIF(TRIM(CAST(${quoteSqlIdentifier(column.name)} AS text)), '') AS ${quoteSqlIdentifier(
            column.name
          )}`
      )
      .join(', ');
    const detailSql = [
      `SELECT ${detailSelect}`,
      `FROM ${qualifiedTable}`,
      `WHERE ${whereSql}`,
      'LIMIT 1;'
    ].join('\n');
    logDebug('dynamic_relations:detail_sql', {
      table: `${schemaName}.${tableName}`,
      signalType,
      sql: detailSql,
      params: sanitizeSqlParamsForLog(params)
    });
    try {
      const detailResponse = await postgresService.queryRead(connectionUrl, detailSql, params, { maxRows: 1 });
      const detailRow = Array.isArray(detailResponse?.rows) ? detailResponse.rows[0] || null : null;
      if (detailRow && typeof detailRow === 'object') {
        detailFields = detailColumns
          .map((column) => {
            const rawValue = toSafeDynamicUiText(detailRow[column.name] || '', 120);
            if (!rawValue) {
              return null;
            }
            return {
              label: fieldLabelFromColumnName(column.name),
              value: rawValue
            };
          })
          .filter(Boolean)
          .slice(0, 3);
      }
    } catch (_) {
      detailFields = [];
    }
  }

  const cardRows =
    isSingleResult && detailFields.length
      ? detailFields.map((item) => ({
          label: item.label,
          value: item.value
        }))
      : relationRows;

  const normalizedToRaw = {};
  for (const signal of Array.isArray(sourceSignals) ? sourceSignals : []) {
    if (!signal?.normalized || normalizedToRaw[signal.normalized]) {
      continue;
    }
    normalizedToRaw[signal.normalized] = signal.value || signal.normalized;
  }
  for (const value of normalizedSignals) {
    if (!normalizedToRaw[value]) {
      normalizedToRaw[value] = value;
    }
  }

  const relevanceLevel = String(candidate?.relevanceLevel || '').trim().toLowerCase();
  const relevanceLabel =
    relevanceLevel === 'high'
      ? 'Relevancia alta'
      : relevanceLevel === 'medium'
        ? 'Relevancia media'
        : relevanceLevel === 'low'
          ? 'Relevancia baja'
          : '';
  const captionTokens = [`${totalCount} resultado${totalCount === 1 ? '' : 's'}`];
  if (ownerColumnName) {
    captionTokens.push('Asignado a mi');
  }
  if (relevanceLabel) {
    captionTokens.push(relevanceLabel);
  }
  const detailDescription =
    isSingleResult && detailFields.length
      ? detailFields.map((item) => `${item.label}: ${item.value}`).join(' | ')
      : '';

  return {
    id: `${table.qualifiedName || `${schemaName}.${tableName}`}::${signalType}`,
    title: tableTitleFromName(tableName),
    caption: captionTokens.join(' · '),
    description: detailDescription,
    tableName,
    tableQualifiedName: String(table.qualifiedName || `${schemaName}.${tableName}`),
    signalType,
    totalCount,
    priorityHint: Math.max(0, Number(candidate?.priorityHint) || 0),
    rows: cardRows,
    detailFields,
    meta: {
      schema: schemaName,
      table: tableName,
      matchColumn: String(matchColumn.name || ''),
      labelColumn: String(labelColumn.name || ''),
      ownerColumn: ownerColumnName,
      signalType,
      normalizedSignals: normalizedSignals.slice(0, 12),
      normalizedToRaw,
      singleResult: isSingleResult,
      relevanceLevel
    }
  };
}

function collapseRelationCardsByTable(cards) {
  const byTable = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    const tableKey = String(card?.tableQualifiedName || '').trim();
    if (!tableKey) {
      continue;
    }
    const known = byTable.get(tableKey);
    const nextTotal = Number(card?.totalCount) || 0;
    const knownTotal = Number(known?.totalCount) || 0;
    const nextPriority = Number(card?.priorityHint) || 0;
    const knownPriority = Number(known?.priorityHint) || 0;
    if (!known || nextTotal > knownTotal || (nextTotal === knownTotal && nextPriority > knownPriority)) {
      byTable.set(tableKey, card);
    }
  }
  return Array.from(byTable.values());
}

function buildDynamicRelationsSignalKey(tabContext, signals) {
  const tabId = Number(tabContext?.tabId) || -1;
  const snapshot = getCrmErpDatabaseSchemaSnapshot();
  const schemaStamp = Number(snapshot?.analyzedAt) || 0;
  const meProfile = getCrmErpDatabaseMeProfile();
  const meKey = isCrmErpMeProfileComplete(meProfile)
    ? `${meProfile.tableQualifiedName}|${meProfile.idColumn}|${meProfile.userId}`
    : 'me:none';
  const phones = (Array.isArray(signals?.phones) ? signals.phones : []).map((item) => item?.normalized || '').filter(Boolean);
  const emails = (Array.isArray(signals?.emails) ? signals.emails : []).map((item) => item?.normalized || '').filter(Boolean);
  return `${tabId}|${schemaStamp}|${meKey}|p:${phones.join(',')}|e:${emails.join(',')}`;
}

async function fetchDynamicRelationCards(tabContext, signals) {
  const connectionUrl = getCrmErpDatabaseConnectionUrl();
  const snapshot = getCrmErpDatabaseSchemaSnapshot();
  if (!connectionUrl || !snapshot) {
    return [];
  }
  const meProfile = getCrmErpDatabaseMeProfile();
  const isWhatsappTab = isWhatsappContext(tabContext);
  if (isWhatsappTab) {
    logDebug('whatsapp_contact:fetch_relations_start', {
      tabId: Number(tabContext?.tabId) || -1,
      signalPhones: (Array.isArray(signals?.phones) ? signals.phones : []).map(
        (item) => item?.normalized || ''
      ),
      signalEmails: (Array.isArray(signals?.emails) ? signals.emails : []).map(
        (item) => item?.normalized || ''
      ),
      meProfile: isCrmErpMeProfileComplete(meProfile)
        ? {
            table: toSafeLogText(meProfile.tableQualifiedName || '', 180),
            idColumn: toSafeLogText(meProfile.idColumn || '', 80),
            userId: toSafeLogText(meProfile.userId || '', 80)
          }
        : null
    });
  }

  const whatsappContactFirstCards = await fetchWhatsappContactFirstRelationCards(
    connectionUrl,
    snapshot,
    tabContext,
    signals
  );
  if (whatsappContactFirstCards.length) {
    if (isWhatsappTab) {
      logDebug('whatsapp_contact:fetch_relations_contact_id_success', {
        relationTables: whatsappContactFirstCards.map((card) =>
          toSafeLogText(card?.tableQualifiedName || card?.title || '', 200)
        )
      });
    }
    return whatsappContactFirstCards;
  }
  if (isWhatsappTab) {
    logDebug('whatsapp_contact:fetch_relations_fallback_signal_scan');
  }

  const phoneSignals = Array.isArray(signals?.phones) ? signals.phones : [];
  const emailSignals = Array.isArray(signals?.emails) ? signals.emails : [];
  const tasks = [];

  if (phoneSignals.length) {
    const phoneCandidates = buildRelationTableCandidates(snapshot, 'phone', {
      limit: 8,
      excludeContactTables: isWhatsappTab,
      meProfile
    });
    const phoneValues = phoneSignals.map((item) => item.normalized).filter(Boolean).slice(0, 8);
    for (const candidate of phoneCandidates) {
      tasks.push(queryRelationCardForCandidate(connectionUrl, candidate, 'phone', phoneValues, phoneSignals));
    }
  }

  if (emailSignals.length) {
    const emailCandidates = buildRelationTableCandidates(snapshot, 'email', {
      limit: 8,
      excludeContactTables: isWhatsappTab,
      meProfile
    });
    const emailValues = emailSignals.map((item) => item.normalized).filter(Boolean).slice(0, 8);
    for (const candidate of emailCandidates) {
      tasks.push(queryRelationCardForCandidate(connectionUrl, candidate, 'email', emailValues, emailSignals));
    }
  }

  if (!tasks.length) {
    return [];
  }

  const settled = await Promise.all(tasks.map((task) => task.catch(() => null)));
  const found = settled.filter(Boolean);
  return collapseRelationCardsByTable(found);
}

function summarizeRelationRow(row) {
  const label = toSafeDynamicUiText(row?.label || '', 84) || '(sin etiqueta)';
  const value = toSafeDynamicUiText(row?.value || '', 84);
  const count = Math.max(0, Number(row?.count) || 0);

  if (value) {
    return `${label}: ${value}`;
  }

  return `${label}: ${count}`;
}

function buildRelationSimpleColumns(cardModel) {
  const card = cardModel && typeof cardModel === 'object' ? cardModel : {};
  const title = toSafeDynamicUiText(card.title || 'Relacion', 92) || 'Relacion';
  const caption = toSafeDynamicUiText(
    card.caption || `${Math.max(0, Number(card.totalCount) || 0)} resultado${Math.max(0, Number(card.totalCount) || 0) === 1 ? '' : 's'}`,
    96
  );
  const rows = Array.isArray(card.rows) ? card.rows : [];
  const rowSummary = rows.map((row) => summarizeRelationRow(row)).filter(Boolean).slice(0, 2).join(' · ');
  const description = toSafeDynamicUiText(card.description || '', 120);
  const detail = rowSummary || description || 'Sin detalle';

  return [title, caption || '-', detail];
}

async function fetchDynamicRelationGroups(cardModel) {
  const card = cardModel && typeof cardModel === 'object' ? cardModel : null;
  const meta = card?.meta && typeof card.meta === 'object' ? card.meta : {};
  const schema = String(meta.schema || '').trim();
  const table = String(meta.table || '').trim();
  const matchColumn = String(meta.matchColumn || '').trim();
  const labelColumn = String(meta.labelColumn || '').trim();
  const ownerColumn = String(meta.ownerColumn || '').trim();
  const signalType = String(meta.signalType || '').trim().toLowerCase();
  const normalizedSignals = Array.isArray(meta.normalizedSignals) ? meta.normalizedSignals.filter(Boolean).slice(0, 12) : [];
  if (!schema || !table || !matchColumn || !labelColumn || !normalizedSignals.length) {
    return [];
  }

  const connectionUrl = getCrmErpDatabaseConnectionUrl();
  if (!connectionUrl) {
    return [];
  }

  const qualifiedTable = `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
  const matchExpr = `CAST(${quoteSqlIdentifier(matchColumn)} AS text)`;
  const normalizedExpr = buildSignalMatchExpression(signalType, matchExpr);
  const labelExprRaw = `CAST(${quoteSqlIdentifier(labelColumn)} AS text)`;
  const labelExpr = `COALESCE(NULLIF(TRIM(${labelExprRaw}), ''), NULLIF(TRIM(${matchExpr}), ''), '(sin etiqueta)')`;
  const whereClauses = [`${normalizedExpr} = ANY($1::text[])`];
  const params = [normalizedSignals];
  if (ownerColumn) {
    const meProfile = getCrmErpDatabaseMeProfile();
    const ownerUserId = isCrmErpMeProfileComplete(meProfile) ? String(meProfile.userId || '').trim() : '';
    if (ownerUserId) {
      params.push(ownerUserId);
      whereClauses.push(`TRIM(CAST(${quoteSqlIdentifier(ownerColumn)} AS text)) = $${params.length}`);
    }
  }
  const whereSql = whereClauses.join(' AND ');
  const sql = [
    `SELECT ${normalizedExpr} AS detected_value, ${labelExpr} AS item_label, COUNT(*)::int AS item_count`,
    `FROM ${qualifiedTable}`,
    `WHERE ${whereSql}`,
    'GROUP BY 1, 2',
    'ORDER BY detected_value ASC, item_count DESC, item_label ASC',
    'LIMIT 240;'
  ].join('\n');

  logDebug('dynamic_relations:detail_groups_sql', {
    table: `${schema}.${table}`,
    signalType,
    ownerColumn: ownerColumn || '',
    sql,
    params: sanitizeSqlParamsForLog(params)
  });
  const response = await postgresService.queryRead(connectionUrl, sql, params, { maxRows: 240 });
  const rows = Array.isArray(response?.rows) ? response.rows : [];
  logDebug('dynamic_relations:detail_groups_result', {
    table: `${schema}.${table}`,
    rowCount: rows.length,
    preview: rows.slice(0, 6).map((row) => ({
      detected_value: toSafeLogText(row?.detected_value || '', 120),
      item_label: toSafeLogText(row?.item_label || '', 140),
      item_count: Math.max(0, Number(row?.item_count) || 0)
    }))
  });
  if (!rows.length) {
    return [];
  }

  const lookup = meta.normalizedToRaw && typeof meta.normalizedToRaw === 'object' ? meta.normalizedToRaw : {};
  const byGroup = new Map();
  for (const row of rows) {
    const rawKey = toSafeDynamicUiText(row?.detected_value || '', 160);
    if (!rawKey) {
      continue;
    }
    const displayKey = toSafeDynamicUiText(lookup[rawKey] || rawKey, 160) || rawKey;
    const label = toSafeDynamicUiText(row?.item_label || '(sin etiqueta)', 120) || '(sin etiqueta)';
    const count = Math.max(0, Number(row?.item_count) || 0);
    if (!byGroup.has(rawKey)) {
      byGroup.set(rawKey, {
        key: rawKey,
        label: displayKey,
        items: []
      });
    }
    byGroup.get(rawKey).items.push({ label, count });
  }

  return Array.from(byGroup.values());
}

  return {
    buildDynamicRelationsSignalKey,
    buildRelationSimpleColumns,
    collectDynamicSignalsFromTab,
    fetchDynamicRelationCards,
    fetchDynamicRelationGroups,
    isEmailColumnName,
    isLabelColumnName,
    isLikelyIdColumnName
  };
}
