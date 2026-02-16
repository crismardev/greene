const TOOL_CALL_ALIASES = Object.freeze({
  'browser.list_tabs': 'browser.listTabs',
  'browser.listTabs': 'browser.listTabs',
  'browser.get_recent_history': 'browser.getRecentHistory',
  'browser.getRecentHistory': 'browser.getRecentHistory',
  'browser.query_history_range': 'browser.queryHistoryRange',
  'browser.history_range': 'browser.queryHistoryRange',
  'browser.query_history_by_date_range': 'browser.queryHistoryRange',
  'browser.queryHistoryByDateRange': 'browser.queryHistoryRange',
  'browser.historyByRange': 'browser.queryHistoryRange',
  'browser.queryHistoryRange': 'browser.queryHistoryRange',
  'browser.get_oldest_history_visit': 'browser.getOldestHistoryVisit',
  'browser.oldest_history_visit': 'browser.getOldestHistoryVisit',
  'browser.getOldestHistoryVisit': 'browser.getOldestHistoryVisit',
  'browser.open_new_tab': 'browser.openNewTab',
  'browser.openTab': 'browser.openNewTab',
  'browser.openNewTab': 'browser.openNewTab',
  'browser.focus_tab': 'browser.focusTab',
  'browser.focusTab': 'browser.focusTab',
  'browser.close_tab': 'browser.closeTab',
  'browser.closeTab': 'browser.closeTab',
  'browser.close_non_productivity_tabs': 'browser.closeNonProductivityTabs',
  'browser.closeNonProductivityTabs': 'browser.closeNonProductivityTabs',
  'whatsapp.get_inbox': 'whatsapp.getInbox',
  'whatsapp.getListInbox': 'whatsapp.getInbox',
  'whatsapp.getInbox': 'whatsapp.getInbox',
  'whatsapp.open_chat': 'whatsapp.openChat',
  'whatsapp.openChatByQuery': 'whatsapp.openChat',
  'whatsapp.openChat': 'whatsapp.openChat',
  'whatsapp.send_message': 'whatsapp.sendMessage',
  'whatsapp.sendText': 'whatsapp.sendMessage',
  'whatsapp.sendMessage': 'whatsapp.sendMessage',
  'whatsapp.open_chat_and_send_message': 'whatsapp.openChatAndSendMessage',
  'whatsapp.openAndSendMessage': 'whatsapp.openChatAndSendMessage',
  'whatsapp.openChatAndSendMessage': 'whatsapp.openChatAndSendMessage',
  'whatsapp.archive_chats': 'whatsapp.archiveChats',
  'whatsapp.archiveListChats': 'whatsapp.archiveChats',
  'whatsapp.archiveChats': 'whatsapp.archiveChats',
  'whatsapp.archive_groups': 'whatsapp.archiveGroups',
  'whatsapp.archiveGroups': 'whatsapp.archiveGroups',
  'db.refresh_schema': 'db.refreshSchema',
  'db.inspect_schema': 'db.refreshSchema',
  'db.describeSchema': 'db.refreshSchema',
  'db.refreshSchema': 'db.refreshSchema',
  'db.query_read': 'db.queryRead',
  'db.read_query': 'db.queryRead',
  'db.readQuery': 'db.queryRead',
  'db.queryRead': 'db.queryRead',
  'db.query_write': 'db.queryWrite',
  'db.write_query': 'db.queryWrite',
  'db.writeQuery': 'db.queryWrite',
  'db.queryWrite': 'db.queryWrite',
  'smtp.send_mail': 'smtp.sendMail',
  'smtp.sendEmail': 'smtp.sendMail',
  'smtp.sendMail': 'smtp.sendMail',
  'maps.get_current_location': 'maps.getCurrentLocation',
  'maps.getCurrentLocation': 'maps.getCurrentLocation',
  'maps.get_nearby_places': 'maps.getNearbyPlaces',
  'maps.getNearbyPlaces': 'maps.getNearbyPlaces',
  'maps.get_locations_places': 'maps.getNearbyPlaces',
  'maps.getLocationsPlaces': 'maps.getNearbyPlaces',
  'maps.get_places': 'maps.getNearbyPlaces',
  'maps.search_places': 'maps.searchPlaces',
  'maps.searchPlaces': 'maps.searchPlaces',
  'maps.search_nearby': 'maps.searchPlaces',
  'maps.find_places': 'maps.searchPlaces',
  'maps.reverse_geocode': 'maps.reverseGeocode',
  'maps.reverseGeocode': 'maps.reverseGeocode',
  'maps.get_current_address': 'maps.reverseGeocode',
  'maps.getCurrentAddress': 'maps.reverseGeocode',
  'maps.get_directions_time': 'maps.getDirectionsTime',
  'maps.getDirectionsTime': 'maps.getDirectionsTime',
  'maps.get_directions_duration': 'maps.getDirectionsTime',
  'integration.call': 'integration.call',
  'integration.invoke': 'integration.call',
  'integration.run': 'integration.call'
});

function noop() {}

export function normalizeLocalToolCall(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const inputTool = String(source.tool || source.action || '').trim();
  const tool = TOOL_CALL_ALIASES[inputTool] || '';
  const args = source.args && typeof source.args === 'object' ? source.args : {};

  if (!tool) {
    return null;
  }

  return { tool, args };
}

export function extractToolCallsFromText(text, options = {}) {
  const source = String(text || '');
  const maxCalls = Math.max(1, Math.min(10, Number(options.maxCalls) || 3));
  const onDebug = typeof options.onDebug === 'function' ? options.onDebug : noop;
  const onWarn = typeof options.onWarn === 'function' ? options.onWarn : noop;

  if (!source) {
    onDebug('extractToolCallsFromText:empty');
    return [];
  }

  const calls = [];
  const blockRegex = /```(?:tool|json)\s*([\s\S]*?)```/gi;
  const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  const chunks = [];

  let match = null;
  while ((match = blockRegex.exec(source))) {
    if (match[1]) {
      chunks.push(match[1].trim());
    }
  }

  while ((match = xmlRegex.exec(source))) {
    if (match[1]) {
      chunks.push(match[1].trim());
    }
  }

  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }

    const normalizedChunk = chunk.replace(/^json\s*/i, '').trim();

    try {
      const parsed = JSON.parse(normalizedChunk);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        const normalized = normalizeLocalToolCall(item);
        if (normalized) {
          calls.push(normalized);
        }
      }
    } catch (_) {
      onWarn('extractToolCallsFromText:invalid_block', {
        chunk: normalizedChunk.slice(0, 360)
      });
    }

    if (calls.length >= maxCalls) {
      break;
    }
  }

  const parsed = calls.slice(0, maxCalls);
  onDebug('extractToolCallsFromText:parsed', {
    parsedCount: parsed.length,
    parsed
  });
  return parsed;
}
