/**
 * HTML Sanitizer Utility for Incoming Email Bodies
 * Strips script tags, iframe, object, embed, event handlers (onload, onerror, etc.), and javascript: links
 * while preserving HTML formatting (p, br, div, table, b, i, a, img, etc.).
 */
function sanitizeHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let sanitized = rawHtml;

  // 1. Remove dangerous script, iframe, object, embed, style, form tags
  sanitized = sanitized.replace(/<(script|iframe|object|embed|style|form|applet|meta)[^>]*>[\s\S]*?<\/\1>/gi, '');
  sanitized = sanitized.replace(/<(script|iframe|object|embed|style|form|applet|meta)[^>]*\/?>/gi, '');

  // 2. Remove inline event handlers (e.g. onload=..., onerror=..., onclick=...)
  sanitized = sanitized.replace(/\s+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');

  // 3. Neutralize javascript: and data: URIs in href and src attributes (except standard images)
  sanitized = sanitized.replace(/(href|src)\s*=\s*['"]?\s*javascript:[^'"]*['"]?/gi, '$1="#"');
  sanitized = sanitized.replace(/(href)\s*=\s*['"]?\s*data:[^'"]*['"]?/gi, '$1="#"');

  return sanitized.trim();
}

module.exports = { sanitizeHtml };
