import en from './en.js';
import zh from './zh.js';

/**
 * Tiny translation layer. Text is looked up by key in the active locale and falls back to
 * English, then to the key itself, so a missing translation is visible but never crashes.
 */
const DICTIONARIES = { en, zh };
export const LOCALES = Object.freeze(['en', 'zh']);
export const LOCALE_LABELS = Object.freeze({ en: 'English', zh: '中文' });

let activeLocale = 'en';

export function setLocale(locale) {
    if (DICTIONARIES[locale]) activeLocale = locale;
}

export function getLocale() {
    return activeLocale;
}

/** Picks Chinese for Chinese browsers, English otherwise. */
export function detectLocale() {
    const language = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
    return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * @param {string} locale
 * @param {string} key
 * @param {Record<string, string | number>} [params] values for `{name}` placeholders
 */
export function translate(locale, key, params) {
    const template = DICTIONARIES[locale]?.[key] ?? en[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** Translates with the active locale (for non-React code; components use `useT`). */
export function t(key, params) {
    return translate(activeLocale, key, params);
}

export function hasText(key) {
    return key in en;
}
