// Shared module: chrome.i18n helpers and HTML escaping for popup rendering.

/**
 * Look up a localized message. Falls back to the message name itself when
 * the lookup returns an empty string, so missing keys are easy to spot.
 */
export function t(messageName, substitutions) {
    const msg = chrome.i18n.getMessage(messageName, substitutions);
    return msg || messageName;
}

/**
 * Batch-apply i18n messages under root (popup only, needs DOM):
 * [data-i18n] -> textContent, [data-i18n-placeholder] -> placeholder,
 * [data-i18n-title] -> title attribute.
 */
export function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
}

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

/** Escape a string for safe interpolation into innerHTML. */
export function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}
