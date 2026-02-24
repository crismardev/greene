const GMAIL_HOSTNAME = 'mail.google.com';

const NON_MESSAGE_ROUTE_TOKENS = new Set([
  'all',
  'category',
  'chat',
  'chats',
  'compose',
  'drafts',
  'imp',
  'important',
  'inbox',
  'label',
  'search',
  'sent',
  'settings',
  'snoozed',
  'spam',
  'starred',
  'trash'
]);

function decodeHashSegment(value) {
  const source = String(value || '').trim();
  if (!source) {
    return '';
  }

  try {
    return decodeURIComponent(source);
  } catch (_) {
    return source;
  }
}

function getGmailHashRouteSegments(hashValue) {
  const hashPath = String(hashValue || '')
    .replace(/^#/, '')
    .split('?')[0]
    .trim();
  if (!hashPath) {
    return [];
  }

  return hashPath
    .split('/')
    .map((segment) => decodeHashSegment(segment).trim())
    .filter(Boolean);
}

function isLikelyGmailMessageToken(value) {
  const token = String(value || '').trim();
  if (!token) {
    return false;
  }

  const lower = token.toLowerCase();
  if (lower.length < 12 || lower.length > 220 || NON_MESSAGE_ROUTE_TOKENS.has(lower)) {
    return false;
  }

  if (lower.startsWith('fm') || lower.startsWith('thread-f:') || lower.startsWith('msg-f:')) {
    return true;
  }

  if (/^[a-f0-9]{16,}$/i.test(token)) {
    return true;
  }

  return /^[A-Za-z0-9_-]{18,}$/.test(token);
}

function hasThreadDepth(firstSegment, segmentCount) {
  if (segmentCount < 2) {
    return false;
  }

  if (firstSegment === 'label' || firstSegment === 'category' || firstSegment === 'search') {
    return segmentCount >= 3;
  }

  return true;
}

function getGmailUrlFromContext(tabContext) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  return String(context.url || '').trim();
}

export function isGmailContext(tabContext) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const site = String(context.site || '').trim().toLowerCase();
  if (site === 'gmail') {
    return true;
  }

  const rawUrl = getGmailUrlFromContext(context);
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.toLowerCase() === GMAIL_HOSTNAME;
  } catch (_) {
    return false;
  }
}

export function isGmailMessageOpenContext(tabContext) {
  if (!isGmailContext(tabContext)) {
    return false;
  }

  const rawUrl = getGmailUrlFromContext(tabContext);
  if (!rawUrl) {
    return false;
  }

  let parsed = null;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }

  const routeSegments = getGmailHashRouteSegments(parsed.hash);
  if (!routeSegments.length) {
    return false;
  }

  const firstSegment = String(routeSegments[0] || '').trim().toLowerCase();
  if (!hasThreadDepth(firstSegment, routeSegments.length)) {
    return false;
  }

  const tailSegment = routeSegments[routeSegments.length - 1];
  return isLikelyGmailMessageToken(tailSegment);
}
