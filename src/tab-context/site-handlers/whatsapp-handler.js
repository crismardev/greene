(() => {
  'use strict';

  // Browser-side automation pack aligned with common operations from whatsapp-web.js / Baileys.
  const REGISTRY_KEY = 'GreenStudioSiteHandlers';

  function getRegistry() {
    if (!window[REGISTRY_KEY]) {
      window[REGISTRY_KEY] = [];
    }

    return window[REGISTRY_KEY];
  }

  function toSafeText(value, limit = 1200) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return '';
    }

    return text.slice(0, limit);
  }

  function normalizePhone(value) {
    const source = String(value || '').trim();
    if (!source) {
      return '';
    }

    const plus = source.startsWith('+');
    const digits = source.replace(/\D/g, '');
    if (!digits) {
      return '';
    }

    return `${plus ? '+' : ''}${digits}`;
  }

  function extractPhoneCandidate(value) {
    const source = String(value || '');
    if (!source) {
      return '';
    }

    const fromWid = source.match(/([0-9]{7,})@/);
    if (fromWid && fromWid[1]) {
      return normalizePhone(fromWid[1]);
    }

    const common = source.match(/(\+?[0-9][0-9\s().-]{6,}[0-9])/);
    if (common && common[1]) {
      return normalizePhone(common[1]);
    }

    return '';
  }

  function parseStorageCandidate(raw) {
    if (raw === null || raw === undefined) {
      return '';
    }

    if (typeof raw === 'string') {
      const direct = extractPhoneCandidate(raw);
      if (direct) {
        return direct;
      }

      try {
        const parsed = JSON.parse(raw);
        return parseStorageCandidate(parsed);
      } catch (_) {
        return '';
      }
    }

    if (typeof raw === 'object') {
      const priorityFields = ['user', 'wid', 'id', 'me', 'phone', 'jid', 'serialized'];
      for (const field of priorityFields) {
        if (!Object.prototype.hasOwnProperty.call(raw, field)) {
          continue;
        }

        const candidate = parseStorageCandidate(raw[field]);
        if (candidate) {
          return candidate;
        }
      }

      for (const key of Object.keys(raw)) {
        const candidate = parseStorageCandidate(raw[key]);
        if (candidate) {
          return candidate;
        }
      }
    }

    return '';
  }

  function getMyNumber() {
    const localStorageKeys = ['last-wid-md', 'last-wid', 'lastKnownPhone'];

    for (const key of localStorageKeys) {
      let raw = '';

      try {
        raw = localStorage.getItem(key);
      } catch (_) {
        raw = '';
      }

      const candidate = parseStorageCandidate(raw);
      if (candidate) {
        return candidate;
      }
    }

    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || (!key.includes('wid') && !key.includes('phone'))) {
          continue;
        }

        const raw = localStorage.getItem(key);
        const candidate = parseStorageCandidate(raw);
        if (candidate) {
          return candidate;
        }
      }
    } catch (_) {
      // Ignore localStorage access issues.
    }

    return '';
  }

  function getCurrentChatTitle() {
    const selectors = [
      '[data-testid="conversation-info-header-chat-title"]',
      'header [role="button"] span[dir="auto"]',
      'header span[title]'
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }

      const value = node.getAttribute('title') || node.textContent || '';
      const safe = toSafeText(value, 240);
      if (safe) {
        return safe;
      }
    }

    return '';
  }

  function getCurrentChatPhone() {
    const searchParams = new URLSearchParams(location.search);
    const fromSearch = normalizePhone(searchParams.get('phone'));
    if (fromSearch) {
      return fromSearch;
    }

    const title = getCurrentChatTitle();
    const fromTitle = extractPhoneCandidate(title);
    if (fromTitle) {
      return fromTitle;
    }

    const breadcrumb = document.querySelector('[data-testid="chatlist-header"]');
    const fromBreadcrumb = extractPhoneCandidate(breadcrumb?.textContent || '');
    if (fromBreadcrumb) {
      return fromBreadcrumb;
    }

    return '';
  }

  function parseMessageTimestamp(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
      return '';
    }

    return raw.slice(0, 96);
  }

  function getMessageText(row) {
    if (!row) {
      return '';
    }

    const chunks = [];
    const textNodes = row.querySelectorAll('span.selectable-text span, div.copyable-text span.selectable-text');

    for (const node of textNodes) {
      const value = toSafeText(node.textContent || '', 380);
      if (value) {
        chunks.push(value);
      }
    }

    if (!chunks.length) {
      const captionNode = row.querySelector('[data-testid="media-caption"]');
      const mediaCaption = toSafeText(captionNode?.textContent || '', 280);
      if (mediaCaption) {
        chunks.push(mediaCaption);
      }
    }

    const unique = Array.from(new Set(chunks));
    return unique.join(' ').trim();
  }

  function getConversationMessages(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 80);
    const rows = Array.from(document.querySelectorAll('div[data-testid="msg-container"]'));

    const parsed = rows
      .map((row, index) => {
        const text = getMessageText(row);
        const prePlain = row.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
        const role = row.classList.contains('message-out') ? 'me' : 'contact';
        const id = row.getAttribute('data-id') || `${Date.now()}-${index}`;

        if (!text) {
          return null;
        }

        return {
          id,
          role,
          text: toSafeText(text, 800),
          timestamp: parseMessageTimestamp(prePlain)
        };
      })
      .filter(Boolean);

    if (parsed.length <= limit) {
      return parsed;
    }

    return parsed.slice(parsed.length - limit);
  }

  function getInboxList(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 40);
    const items = Array.from(document.querySelectorAll('#pane-side [role="listitem"]'));

    const parsed = items
      .map((item, index) => {
        const titleNode = item.querySelector('span[title]');
        const title = toSafeText(titleNode?.getAttribute('title') || titleNode?.textContent || '', 180);

        if (!title) {
          return null;
        }

        const previewCandidates = item.querySelectorAll('div[dir="ltr"], span[dir="auto"]');
        let preview = '';

        for (const node of previewCandidates) {
          const value = toSafeText(node.textContent || '', 220);
          if (value && value !== title) {
            preview = value;
            break;
          }
        }

        return {
          id: `${index}-${title}`,
          title,
          phone: extractPhoneCandidate(title),
          preview
        };
      })
      .filter(Boolean);

    if (parsed.length <= limit) {
      return parsed;
    }

    return parsed.slice(0, limit);
  }

  function getSendButton() {
    const selectors = [
      'footer button[data-testid="compose-btn-send"]',
      'footer button[data-testid="send"]',
      'footer button[aria-label="Send"]',
      'footer button[aria-label="Enviar"]'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) {
        return button;
      }
    }

    const icon = document.querySelector('footer span[data-icon="send"]');
    return icon ? icon.closest('button') : null;
  }

  function getComposerEditor() {
    const selectors = [
      'footer div[contenteditable="true"][role="textbox"]',
      'footer div[contenteditable="true"][data-tab]'
    ];

    for (const selector of selectors) {
      const editor = document.querySelector(selector);
      if (editor) {
        return editor;
      }
    }

    return null;
  }

  async function sendMessageToCurrentChat(text) {
    const message = String(text || '').trim();
    if (!message) {
      return {
        ok: false,
        error: 'Texto vacio.'
      };
    }

    const editor = getComposerEditor();
    if (!editor) {
      return {
        ok: false,
        error: 'No se encontro el input de mensaje.'
      };
    }

    editor.focus();

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, message);
    } catch (_) {
      // execCommand may fail in some contexts.
    }

    if (toSafeText(editor.textContent || '', 2000) !== toSafeText(message, 2000)) {
      editor.textContent = message;
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: message,
          inputType: 'insertText'
        })
      );
    }

    const sendButton = getSendButton();
    if (sendButton) {
      sendButton.click();
    } else {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
          code: 'Enter',
          which: 13,
          keyCode: 13
        })
      );
      editor.dispatchEvent(
        new KeyboardEvent('keyup', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
          code: 'Enter',
          which: 13,
          keyCode: 13
        })
      );
    }

    return {
      ok: true,
      result: {
        sent: true,
        text: message
      }
    };
  }

  function collectContext(options = {}) {
    const textLimit = Math.max(300, Number(options.textLimit) || 1800);
    const messages = getConversationMessages({ limit: 80 });
    const inbox = getInboxList({ limit: 40 });
    const chatTitle = getCurrentChatTitle();
    const chatPhone = getCurrentChatPhone();

    const messageExcerpt = messages
      .slice(-10)
      .map((item) => `${item.role === 'me' ? 'Yo' : 'Contacto'}: ${item.text}`)
      .join('\n');

    return {
      site: 'whatsapp',
      url: location.href,
      title: toSafeText(document.title || '', 280),
      description: 'WhatsApp Web conversation context',
      textExcerpt: toSafeText(messageExcerpt, textLimit),
      details: {
        myNumber: getMyNumber(),
        currentChat: {
          title: chatTitle,
          phone: chatPhone,
          key: chatPhone || chatTitle || ''
        },
        messages,
        inbox
      }
    };
  }

  function buildContextSignature() {
    const context = collectContext({ textLimit: 800 });
    const chatKey = context.details?.currentChat?.key || '';
    const messageTail = Array.isArray(context.details?.messages)
      ? context.details.messages
          .slice(-3)
          .map((item) => `${item.role}:${item.text}`)
          .join('|')
      : '';

    return `${chatKey}::${messageTail}`;
  }

  function observeContextChanges(onChange) {
    if (typeof onChange !== 'function') {
      return () => {};
    }

    let lastSignature = buildContextSignature();
    let timer = 0;

    const emitIfChanged = (reason) => {
      const next = buildContextSignature();
      if (next === lastSignature) {
        return;
      }

      lastSignature = next;
      onChange(reason);
    };

    const schedule = (reason) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        emitIfChanged(reason);
      }, 220);
    };

    const observer = new MutationObserver(() => {
      schedule('whatsapp_mutation');
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    const onHashChange = () => schedule('whatsapp_hashchange');
    const onVisibilityChange = () => schedule('whatsapp_visibility');

    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const poll = window.setInterval(() => {
      emitIfChanged('whatsapp_poll');
    }, 1600);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      observer.disconnect();
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  async function runAction(action, args = {}) {
    if (action === 'getMyNumber') {
      return {
        ok: true,
        result: getMyNumber()
      };
    }

    if (action === 'getCurrentChat') {
      return {
        ok: true,
        result: {
          title: getCurrentChatTitle(),
          phone: getCurrentChatPhone()
        }
      };
    }

    if (action === 'readMessages' || action === 'getListMessages') {
      return {
        ok: true,
        result: getConversationMessages({ limit: Number(args.limit) || 80 })
      };
    }

    if (action === 'getInbox' || action === 'getListInbox') {
      return {
        ok: true,
        result: getInboxList({ limit: Number(args.limit) || 40 })
      };
    }

    if (action === 'sendMessage') {
      return sendMessageToCurrentChat(args.text || '');
    }

    if (action === 'getAutomationPack') {
      return {
        ok: true,
        result: {
          myNumber: getMyNumber(),
          currentChat: {
            title: getCurrentChatTitle(),
            phone: getCurrentChatPhone()
          },
          messages: getConversationMessages({ limit: Number(args.messageLimit) || 80 }),
          inbox: getInboxList({ limit: Number(args.inboxLimit) || 40 })
        }
      };
    }

    return {
      ok: false,
      error: `Accion no soportada en WhatsApp: ${action || 'unknown'}`
    };
  }

  const handler = {
    site: 'whatsapp',
    priority: 100,
    matches() {
      return location.hostname === 'web.whatsapp.com';
    },
    collectContext,
    observeContextChanges,
    runAction
  };

  const registry = getRegistry();
  if (!registry.some((item) => item && item.site === handler.site)) {
    registry.push(handler);
  }
})();
