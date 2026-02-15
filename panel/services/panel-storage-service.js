export function createPanelStorageService({
  defaultSettings,
  panelSettingsDefaults,
  chatDb,
  maxChatHistoryMessages
}) {
  let settings = { ...defaultSettings };
  let panelSettingsCache = { ...panelSettingsDefaults };
  let chatDbPromise = null;

  function normalizeMessage(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : '';
    if (!role) {
      return null;
    }

    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) {
      return null;
    }

    const id =
      typeof record.id === 'string' && record.id
        ? record.id
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const createdAt = Number(record.createdAt);

    return {
      id,
      role,
      content,
      tool: typeof record.tool === 'string' ? record.tool : 'chat',
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
    };
  }

  function hasDbStore(db, storeName) {
    return Boolean(db && db.objectStoreNames && db.objectStoreNames.contains(storeName));
  }

  function getChatDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.resolve(null);
    }

    if (!chatDbPromise) {
      chatDbPromise = new Promise((resolve) => {
        const request = indexedDB.open(chatDb.NAME, chatDb.VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(chatDb.CHAT_STORE)) {
            db.createObjectStore(chatDb.CHAT_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(chatDb.SETTINGS_STORE)) {
            db.createObjectStore(chatDb.SETTINGS_STORE, { keyPath: 'key' });
          }
          if (chatDb.SECRET_STORE && !db.objectStoreNames.contains(chatDb.SECRET_STORE)) {
            db.createObjectStore(chatDb.SECRET_STORE, { keyPath: 'key' });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
          };
          resolve(db);
        };

        request.onerror = () => {
          resolve(null);
        };
      });
    }

    return chatDbPromise;
  }

  function getSettings() {
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve({ ...defaultSettings });
        return;
      }

      chrome.storage.sync.get(defaultSettings, (items) => {
        if (chrome.runtime.lastError) {
          resolve({ ...defaultSettings });
          return;
        }

        settings = { ...defaultSettings, ...items };
        resolve({ ...settings });
      });
    });
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };

    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve(true);
        return;
      }

      chrome.storage.sync.set(patch, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  async function readChatHistory() {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, chatDb.CHAT_STORE)) {
      return [];
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.CHAT_STORE, 'readonly');
      } catch {
        resolve([]);
        return;
      }

      const store = tx.objectStore(chatDb.CHAT_STORE);
      const req = store.get(chatDb.CHAT_KEY);

      req.onsuccess = () => {
        const raw = req.result && Array.isArray(req.result.messages) ? req.result.messages : [];
        const normalized = raw.map(normalizeMessage).filter(Boolean).slice(-maxChatHistoryMessages);
        resolve(normalized);
      };

      req.onerror = () => {
        resolve([]);
      };
    });
  }

  async function saveChatHistory(messages) {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, chatDb.CHAT_STORE)) {
      return false;
    }

    const payload = {
      key: chatDb.CHAT_KEY,
      messages: (Array.isArray(messages) ? messages : []).slice(-maxChatHistoryMessages),
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.CHAT_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.CHAT_STORE).put(payload);
    });
  }

  async function readPanelSettings() {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, chatDb.SETTINGS_STORE)) {
      panelSettingsCache = { ...panelSettingsDefaults };
      return { ...panelSettingsCache };
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SETTINGS_STORE, 'readonly');
      } catch {
        panelSettingsCache = { ...panelSettingsDefaults };
        resolve({ ...panelSettingsCache });
        return;
      }

      const store = tx.objectStore(chatDb.SETTINGS_STORE);
      const req = store.get(chatDb.SETTINGS_KEY);

      req.onsuccess = () => {
        const value = req.result && typeof req.result.value === 'object' ? req.result.value : {};
        panelSettingsCache = { ...panelSettingsDefaults, ...value };
        resolve({ ...panelSettingsCache });
      };

      req.onerror = () => {
        panelSettingsCache = { ...panelSettingsDefaults };
        resolve({ ...panelSettingsCache });
      };
    });
  }

  async function savePanelSettings(nextSettings) {
    const db = await getChatDatabase();
    panelSettingsCache = { ...panelSettingsCache, ...nextSettings };

    if (!db || !hasDbStore(db, chatDb.SETTINGS_STORE)) {
      return true;
    }

    const payload = {
      key: chatDb.SETTINGS_KEY,
      value: panelSettingsCache,
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SETTINGS_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.SETTINGS_STORE).put(payload);
    });
  }

  async function readSecret(secretKey) {
    const key = String(secretKey || '').trim();
    if (!key) {
      return null;
    }

    const db = await getChatDatabase();
    if (!db || !chatDb.SECRET_STORE || !hasDbStore(db, chatDb.SECRET_STORE)) {
      return null;
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SECRET_STORE, 'readonly');
      } catch {
        resolve(null);
        return;
      }

      const req = tx.objectStore(chatDb.SECRET_STORE).get(key);

      req.onsuccess = () => {
        const value = req.result && typeof req.result.value === 'object' ? req.result.value : null;
        resolve(value ? { ...value } : null);
      };

      req.onerror = () => {
        resolve(null);
      };
    });
  }

  async function saveSecret(secretKey, value) {
    const key = String(secretKey || '').trim();
    if (!key) {
      return false;
    }

    const db = await getChatDatabase();
    if (!db || !chatDb.SECRET_STORE || !hasDbStore(db, chatDb.SECRET_STORE)) {
      return false;
    }

    const payload = {
      key,
      value: value && typeof value === 'object' ? { ...value } : {},
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SECRET_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.SECRET_STORE).put(payload);
    });
  }

  async function deleteSecret(secretKey) {
    const key = String(secretKey || '').trim();
    if (!key) {
      return false;
    }

    const db = await getChatDatabase();
    if (!db || !chatDb.SECRET_STORE || !hasDbStore(db, chatDb.SECRET_STORE)) {
      return false;
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SECRET_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.SECRET_STORE).delete(key);
    });
  }

  return {
    getSettings,
    saveSettings,
    readChatHistory,
    saveChatHistory,
    readPanelSettings,
    savePanelSettings,
    readSecret,
    saveSecret,
    deleteSecret
  };
}
