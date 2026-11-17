import { hasTranslation } from '../i18n/index.js';

/**
 * The text of a tutorial card for the controls in use: `tutorial.<id>.<field>` with an
 * optional `.touch` / `.vr` twin (shared by the page's card and the headset's).
 * @param {(key: string) => string} t
 * @param {string} key e.g. 'tutorial.steer.text'
 * @param {string} platform 'desktop' | 'touch' | 'vr' (config/tutorial.js)
 * @returns {string | null} null when the card has no such line (an info card names no keys)
 */
export function tutorialText(t, key, platform) {
    const twin = `${key}.${platform}`;
    if (hasTranslation(twin)) return t(twin);
    return hasTranslation(key) ? t(key) : null;
}

/** The controls a card names, one entry per key cap ("W / S" is two). */
export function tutorialKeys(t, stepId, platform) {
    const keys = tutorialText(t, `tutorial.${stepId}.keys`, platform);
    return keys ? keys.split(' / ') : [];
}
