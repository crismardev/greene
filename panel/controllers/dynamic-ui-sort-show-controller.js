function toSafeText(value, limit = 240) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) {
    return ''
  }

  return text.slice(0, Math.max(0, Number(limit) || 0))
}

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeSuggestion(item, index = 0) {
  const source = item && typeof item === 'object' ? item : {}
  const id = toSafeText(source.id || `suggestion-${index + 1}`, 120)
  if (!id) {
    return null
  }

  const description = toSafeText(source.description || source.text || '', 520)
  if (!description && source.loading !== true) {
    return null
  }

  return {
    id,
    source: String(source.source || 'predefined').toLowerCase(),
    site: String(source.site || 'generic').toLowerCase(),
    title: toSafeText(source.title || 'Suggestion', 120),
    caption: toSafeText(source.caption || '', 120),
    description: description || 'Generando sugerencia...',
    statusText: toSafeText(source.statusText || '', 200),
    statusError: source.statusError === true,
    loading: source.loading === true,
    canExecute: source.canExecute === true,
    canRegenerate: source.canRegenerate === true,
    priorityHint: toSafeNumber(source.priorityHint, 0),
    actionType: toSafeText(source.actionType || '', 80),
    actionPayload: source.actionPayload && typeof source.actionPayload === 'object' ? source.actionPayload : {}
  }
}

function normalizeRelationCard(card, index = 0) {
  const source = card && typeof card === 'object' ? card : {}
  const id = toSafeText(source.id || `relation-${index + 1}`, 160)
  if (!id) {
    return null
  }

  const title = toSafeText(source.title || source.tableName || 'Tabla', 140)
  const tableQualifiedName = toSafeText(source.tableQualifiedName || '', 180)
  const rows = toSafeArray(source.rows)
    .map((item) => {
      const row = item && typeof item === 'object' ? item : {}
      const label = toSafeText(row.label || row.key || row.value || '', 120)
      const value = toSafeText(row.value || '', 120)
      const count = Math.max(0, Math.round(toSafeNumber(row.count, 0)))
      if (!label && !count && !value) {
        return null
      }
      return {
        label: label || '(sin etiqueta)',
        count,
        value
      }
    })
    .filter(Boolean)
    .slice(0, 3)

  const detailFields = toSafeArray(source.detailFields)
    .map((item) => {
      const field = item && typeof item === 'object' ? item : {}
      const label = toSafeText(field.label || field.key || '', 80)
      const value = toSafeText(field.value || '', 120)
      if (!label || !value) {
        return null
      }
      return { label, value }
    })
    .filter(Boolean)
    .slice(0, 3)

  return {
    id,
    title: title || tableQualifiedName || 'Tabla',
    caption: toSafeText(source.caption || '', 140),
    description: toSafeText(source.description || '', 220),
    tableName: toSafeText(source.tableName || title, 120),
    tableQualifiedName,
    signalType: toSafeText(source.signalType || '', 24),
    totalCount: Math.max(0, Math.round(toSafeNumber(source.totalCount, 0))),
    priorityHint: toSafeNumber(source.priorityHint, 0),
    rows,
    detailFields,
    meta: source.meta && typeof source.meta === 'object' ? source.meta : {}
  }
}

export function createDynamicUiSortShowController(options = {}) {
  const cfg = options && typeof options === 'object' ? options : {}
  const sitePriority = cfg.sitePriority && typeof cfg.sitePriority === 'object'
    ? cfg.sitePriority
    : {
        whatsapp: 12,
        generic: 4
      }

  function scoreSuggestion(item, context = {}) {
    const site = String(context.site || 'generic').toLowerCase()
    const signals = context.signals && typeof context.signals === 'object' ? context.signals : {}
    const phoneCount = toSafeArray(signals.phones).length
    const emailCount = toSafeArray(signals.emails).length
    const signalCount = phoneCount + emailCount
    const sourceWeight = item.source === 'ai_generated' || item.source === 'ai' ? 18 : 6
    const siteWeight = item.site && item.site === site ? 10 : 0
    const actionableWeight = item.canExecute ? 6 : 0
    const regenerateWeight = item.canRegenerate ? 2 : 0
    const loadingPenalty = item.loading ? -4 : 0
    const signalWeight = signalCount ? Math.min(8, signalCount * 2) : 0
    const contextWeight = toSafeNumber(sitePriority[site], 0)

    return (
      item.priorityHint +
      sourceWeight +
      siteWeight +
      actionableWeight +
      regenerateWeight +
      loadingPenalty +
      signalWeight +
      contextWeight
    )
  }

  function scoreRelation(card, context = {}) {
    const site = String(context.site || 'generic').toLowerCase()
    const siteWeight = toSafeNumber(sitePriority[site], 0)
    const rowWeight = Math.min(6, card.rows.length * 2)
    const detailWeight = Math.min(9, card.detailFields.length * 3)
    const signalWeight =
      card.signalType === 'phone' || card.signalType === 'email'
        ? 5
        : card.signalType === 'contact_id'
          ? 7
          : 0
    const volumeWeight = Math.min(25, Math.log10(Math.max(1, card.totalCount)) * 12)
    const relevanceLevel = String(card?.meta?.relevanceLevel || '').toLowerCase()
    const relevanceWeight = relevanceLevel === 'high' ? 9 : relevanceLevel === 'medium' ? 4 : 0

    return card.priorityHint + siteWeight + rowWeight + detailWeight + signalWeight + volumeWeight + relevanceWeight
  }

  function dynamicUiSortAndShow(payload = {}) {
    const sourceSuggestions = toSafeArray(payload.suggestions)
    const sourceRelations = toSafeArray(payload.relations)
    const activeTab = payload.activeTab && typeof payload.activeTab === 'object' ? payload.activeTab : {}
    const context = {
      site: String(activeTab.site || 'generic').toLowerCase(),
      signals: payload.signals && typeof payload.signals === 'object' ? payload.signals : {}
    }

    const suggestions = sourceSuggestions
      .map((item, index) => normalizeSuggestion(item, index))
      .filter(Boolean)
      .sort((left, right) => {
        const scoreDiff = scoreSuggestion(right, context) - scoreSuggestion(left, context)
        if (scoreDiff !== 0) {
          return scoreDiff
        }
        if (left.loading !== right.loading) {
          return left.loading ? -1 : 1
        }
        return left.title.localeCompare(right.title)
      })

    const relations = sourceRelations
      .map((item, index) => normalizeRelationCard(item, index))
      .filter(Boolean)
      .sort((left, right) => {
        const scoreDiff = scoreRelation(right, context) - scoreRelation(left, context)
        if (scoreDiff !== 0) {
          return scoreDiff
        }
        return left.title.localeCompare(right.title)
      })

    return {
      suggestions,
      relations
    }
  }

  return {
    dynamicUiSortAndShow,
    normalizeSuggestion,
    normalizeRelationCard
  }
}
