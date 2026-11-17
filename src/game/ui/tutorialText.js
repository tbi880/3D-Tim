import { hasTranslation } from '../i18n/index.js';

/**
 * The text of a tutorial card for the controls in use: `tutorial.<id>.<field>` with an
 * optional `.touch` / `.vr` twin (shared by the page's card and the headset's).
 * @param {(key: string) => string} t
 * @param {string} key e.g. 'tutorial.steer.text'
 * @param {string} platform 'desktop' | 'touch' | 'vr' (config/tutorial.js)
 * @param {Record<string, string>} [params] values for the text's `{name}` placeholders (tutorialParams)
 * @returns {string | null} null when the card has no such line (an info card names no keys)
 */
export function tutorialText(t, key, platform, params) {
    const twin = `${key}.${platform}`;
    if (hasTranslation(twin)) return t(twin, params);
    return hasTranslation(key) ? t(key, params) : null;
}

/**
 * What a card's text is filled in with: the ability step names the ability of the ship being
 * flown (`tutorial.ability`, its id) and says what it does.
 * @param {(key: string) => string} t
 * @param {{ ability?: string | null }} tutorial the step on screen (state/Tutorial.js `publish`)
 */
export function tutorialParams(t, tutorial) {
    if (!tutorial.ability) return undefined;
    return { name: t(`ability.${tutorial.ability}.name`), what: t(`ability.${tutorial.ability}.text`) };
}

/** The controls a card names, one entry per key cap ("W / S" is two). */
export function tutorialKeys(t, stepId, platform) {
    const keys = tutorialText(t, `tutorial.${stepId}.keys`, platform);
    return keys ? keys.split(' / ') : [];
}
