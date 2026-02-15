export function createBrandEmotionController(options = {}) {
  const cfg = options && typeof options === 'object' ? options : {}
  const assetsByEmotion = cfg.assetsByEmotion && typeof cfg.assetsByEmotion === 'object' ? cfg.assetsByEmotion : {}
  const aliasesByEmotion = cfg.aliasesByEmotion && typeof cfg.aliasesByEmotion === 'object' ? cfg.aliasesByEmotion : {}
  const pointCount = Math.max(8, Number(cfg.pointCount) || 72)
  const morphDurationMs = Math.max(120, Number(cfg.morphDurationMs) || 420)
  const targets = Array.isArray(cfg.targets) ? cfg.targets : []

  const emotionNames = Object.freeze(Object.keys(assetsByEmotion))
  let emotionLibrary = Object.create(null)
  let currentEmotion = ''
  let morphToken = 0
  let metricsPath = null
  let randomTimer = 0
  let randomEnabled = false

  function getAssetUrl(path) {
    if (typeof cfg.assetUrlResolver === 'function') {
      return cfg.assetUrlResolver(path)
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(path)
    }

    return `../${path}`
  }

  function parseNumericAttr(value, fallback) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return fallback
    }

    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : fallback
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function normalizeEmotionName(value) {
    const key = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z_]/g, '')

    return aliasesByEmotion[key] || ''
  }

  function extractEmotionFromText(text) {
    const safeText = typeof text === 'string' ? text.trim() : ''
    if (!safeText) {
      return ''
    }

    const startMatch = safeText.match(/^\[?\s*(?:emotion|emocion)\s*[:=]\s*([a-z_]+)\s*\]?/i)
    if (startMatch) {
      return normalizeEmotionName(startMatch[1])
    }

    const endMatch = safeText.match(/\[?\s*(?:emotion|emocion)\s*[:=]\s*([a-z_]+)\s*\]?\s*$/i)
    if (endMatch) {
      return normalizeEmotionName(endMatch[1])
    }

    return ''
  }

  function stripEmotionTag(text) {
    const raw = typeof text === 'string' ? text : ''
    if (!raw) {
      return ''
    }

    const withoutStart = raw.replace(/^\s*\[?\s*(?:emotion|emocion)\s*[:=]\s*[a-z_]+\s*\]?\s*/i, '')
    const withoutEnd = withoutStart.replace(/\s*\[?\s*(?:emotion|emocion)\s*[:=]\s*[a-z_]+\s*\]?\s*$/i, '')
    return withoutEnd.trim()
  }

  function ensureMetricsPath() {
    if (metricsPath) {
      return metricsPath
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    svg.style.width = '0'
    svg.style.height = '0'
    svg.style.opacity = '0'
    svg.style.pointerEvents = 'none'
    svg.style.overflow = 'hidden'

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.appendChild(path)
    document.body.appendChild(svg)

    metricsPath = path
    return metricsPath
  }

  function samplePathPoints(pathData, targetPointCount = pointCount) {
    const points = []
    const safePointCount = Math.max(8, targetPointCount)
    const metrics = ensureMetricsPath()
    metrics.setAttribute('d', pathData)

    let totalLength = 0
    try {
      totalLength = metrics.getTotalLength()
    } catch (_) {
      return points
    }

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return points
    }

    for (let i = 0; i < safePointCount; i += 1) {
      const ratio = safePointCount === 1 ? 0 : i / (safePointCount - 1)
      const point = metrics.getPointAtLength(totalLength * ratio)
      points.push([point.x, point.y])
    }

    return points
  }

  function pointsToClosedPath(points) {
    if (!Array.isArray(points) || !points.length) {
      return ''
    }

    const [firstX, firstY] = points[0]
    const parts = [`M${firstX.toFixed(2)} ${firstY.toFixed(2)}`]

    for (let i = 1; i < points.length; i += 1) {
      const [x, y] = points[i]
      parts.push(`L${x.toFixed(2)} ${y.toFixed(2)}`)
    }

    parts.push('Z')
    return parts.join(' ')
  }

  function easeInOutSine(value) {
    return -(Math.cos(Math.PI * value) - 1) / 2
  }

  function interpolatePathPoints(fromPoints, toPoints, progress) {
    if (!Array.isArray(fromPoints) || !Array.isArray(toPoints) || !fromPoints.length || !toPoints.length) {
      return []
    }

    if (fromPoints.length !== toPoints.length) {
      return toPoints
    }

    const out = []
    for (let i = 0; i < fromPoints.length; i += 1) {
      const from = fromPoints[i]
      const to = toPoints[i]
      out.push([from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress])
    }

    return out
  }

  function setEmotionPathStyle(pathEl, shape) {
    if (!pathEl || !shape) {
      return
    }

    pathEl.setAttribute('fill', shape.fill)
    pathEl.setAttribute('stroke', shape.stroke)
    pathEl.setAttribute('fill-opacity', String(shape.fillOpacity))
    pathEl.setAttribute('stroke-opacity', String(shape.strokeOpacity))
    pathEl.setAttribute('stroke-width', String(shape.strokeWidth))
  }

  function parseEmotionShape(pathNode) {
    const pathData = pathNode ? pathNode.getAttribute('d') || '' : ''
    if (!pathData) {
      return null
    }

    const points = samplePathPoints(pathData, pointCount)
    if (points.length < 8) {
      return null
    }

    return {
      pathData,
      points,
      morphPathData: pointsToClosedPath(points),
      fill: pathNode.getAttribute('fill') || '#ffffff',
      stroke: pathNode.getAttribute('stroke') || '#3c3c4a',
      fillOpacity: clamp(parseNumericAttr(pathNode.getAttribute('fill-opacity'), 1), 0.08, 1),
      strokeOpacity: clamp(parseNumericAttr(pathNode.getAttribute('stroke-opacity'), 1), 0.08, 1),
      strokeWidth: Math.max(0.8, parseNumericAttr(pathNode.getAttribute('stroke-width'), 3))
    }
  }

  function parseEmotionSvg(source) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(source, 'image/svg+xml')

    if (doc.querySelector('parsererror')) {
      return null
    }

    const svgNode = doc.querySelector('svg')
    if (!svgNode) {
      return null
    }

    const paths = Array.from(svgNode.querySelectorAll('path'))
    if (paths.length < 2) {
      return null
    }

    const right = parseEmotionShape(paths[0])
    const left = parseEmotionShape(paths[1])
    if (!right || !left) {
      return null
    }

    return {
      viewBox: svgNode.getAttribute('viewBox') || '0 0 67 47',
      right,
      left
    }
  }

  async function loadEmotionAsset(emotionName, assetPath) {
    const url = getAssetUrl(assetPath)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`No se pudo cargar ${assetPath}.`)
    }

    const markup = await response.text()
    const parsed = parseEmotionSvg(markup)
    if (!parsed) {
      throw new Error(`SVG invalido para la emocion ${emotionName}.`)
    }

    return {
      name: emotionName,
      ...parsed
    }
  }

  function resolveRenderableEmotionName(name) {
    const normalized = normalizeEmotionName(name)
    if (normalized && emotionLibrary[normalized]) {
      return normalized
    }

    if (emotionLibrary.neutral) {
      return 'neutral'
    }

    const available = Object.keys(emotionLibrary)
    return available.length ? available[0] : ''
  }

  function getRenderableTargets() {
    return targets.filter((target) => target && target.rightPath && target.leftPath)
  }

  function pickRandomEmotion(excluded = '') {
    const source = Object.keys(emotionLibrary).length ? Object.keys(emotionLibrary) : emotionNames
    const pool = source.filter((name) => name !== excluded)
    const names = pool.length ? pool : source

    if (!names.length) {
      return 'neutral'
    }

    return names[Math.floor(Math.random() * names.length)]
  }

  function clearRandomTimer() {
    if (randomTimer) {
      window.clearTimeout(randomTimer)
      randomTimer = 0
    }
  }

  function scheduleRandomTick() {
    if (!randomEnabled) {
      return
    }

    clearRandomTimer()
    const delay = 1200 + Math.floor(Math.random() * 1600)

    randomTimer = window.setTimeout(() => {
      if (!randomEnabled) {
        return
      }

      setEmotion(pickRandomEmotion(currentEmotion), { preserveRandom: true })
      scheduleRandomTick()
    }, delay)
  }

  function startRandomCycle(options = {}) {
    const immediate = options.immediate !== false
    if (!Object.keys(emotionLibrary).length) {
      return
    }

    randomEnabled = true
    clearRandomTimer()

    if (immediate) {
      setEmotion(pickRandomEmotion(currentEmotion), { preserveRandom: true })
    }

    scheduleRandomTick()
  }

  function stopRandomCycle() {
    randomEnabled = false
    clearRandomTimer()
  }

  function setEmotion(emotionName, options = {}) {
    const immediate = Boolean(options.immediate)
    const preserveRandom = Boolean(options.preserveRandom)
    const resolvedName = resolveRenderableEmotionName(emotionName)
    const activeTargets = getRenderableTargets()
    if (!resolvedName || !activeTargets.length) {
      return
    }

    if (!preserveRandom) {
      stopRandomCycle()
    }

    const target = emotionLibrary[resolvedName]
    const from = currentEmotion ? emotionLibrary[currentEmotion] : null

    for (const targetRef of activeTargets) {
      if (targetRef.container) {
        targetRef.container.setAttribute('aria-label', `Greene emotion ${resolvedName}`)
        targetRef.container.dataset.emotion = resolvedName
      }

      setEmotionPathStyle(targetRef.rightPath, target.right)
      setEmotionPathStyle(targetRef.leftPath, target.left)
    }

    if (immediate || !from || !from.right || !from.left || resolvedName === currentEmotion) {
      for (const targetRef of activeTargets) {
        targetRef.rightPath.setAttribute('d', target.right.morphPathData || target.right.pathData)
        targetRef.leftPath.setAttribute('d', target.left.morphPathData || target.left.pathData)
      }
      currentEmotion = resolvedName
      return
    }

    const currentMorphToken = ++morphToken
    const startAt = performance.now()

    const morphFrame = (now) => {
      if (currentMorphToken !== morphToken) {
        return
      }

      const progress = Math.min(1, (now - startAt) / morphDurationMs)
      const eased = easeInOutSine(progress)

      const nextRightPoints = interpolatePathPoints(from.right.points, target.right.points, eased)
      const nextLeftPoints = interpolatePathPoints(from.left.points, target.left.points, eased)

      const nextRightPath = nextRightPoints.length ? pointsToClosedPath(nextRightPoints) : ''
      const nextLeftPath = nextLeftPoints.length ? pointsToClosedPath(nextLeftPoints) : ''

      if (nextRightPath || nextLeftPath) {
        for (const targetRef of activeTargets) {
          if (nextRightPath) {
            targetRef.rightPath.setAttribute('d', nextRightPath)
          }
          if (nextLeftPath) {
            targetRef.leftPath.setAttribute('d', nextLeftPath)
          }
        }
      }

      if (progress < 1) {
        requestAnimationFrame(morphFrame)
        return
      }

      for (const targetRef of activeTargets) {
        targetRef.rightPath.setAttribute('d', target.right.morphPathData || target.right.pathData)
        targetRef.leftPath.setAttribute('d', target.left.morphPathData || target.left.pathData)
      }
    }

    requestAnimationFrame(morphFrame)
    currentEmotion = resolvedName
  }

  async function hydrate() {
    if (!getRenderableTargets().length) {
      return
    }

    const loadedEntries = await Promise.all(
      emotionNames.map(async (emotionName) => {
        const assetPath = assetsByEmotion[emotionName]
        try {
          return await loadEmotionAsset(emotionName, assetPath)
        } catch (_) {
          return null
        }
      })
    )

    const nextLibrary = Object.create(null)
    for (const item of loadedEntries) {
      if (!item) {
        continue
      }
      nextLibrary[item.name] = item
    }

    if (!Object.keys(nextLibrary).length) {
      return
    }

    emotionLibrary = nextLibrary

    const baseViewBox = emotionLibrary.neutral?.viewBox || emotionLibrary[Object.keys(emotionLibrary)[0]]?.viewBox || '0 0 67 47'
    for (const targetRef of getRenderableTargets()) {
      if (targetRef.svg) {
        targetRef.svg.setAttribute('viewBox', baseViewBox)
      }
    }

    const randomEmotion = pickRandomEmotion()
    setEmotion(randomEmotion, { immediate: true, preserveRandom: true })
    startRandomCycle({ immediate: false })
  }

  function extractEmotionFromAssistantMessage(message) {
    return extractEmotionFromText(message)
  }

  function destroy() {
    stopRandomCycle()
    if (metricsPath && metricsPath.ownerSVGElement) {
      metricsPath.ownerSVGElement.remove()
    }
    metricsPath = null
  }

  return {
    extractEmotionFromText,
    stripEmotionTag,
    extractEmotionFromAssistantMessage,
    hydrate,
    setEmotion,
    startRandomCycle,
    stopRandomCycle,
    destroy
  }
}
