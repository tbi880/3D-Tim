/**
 * Everyone who speaks on the comms channel.
 * `portrait` is either an image under /public or the name of a drawn glyph in ui/CommsPanel.jsx.
 */
export const CHARACTERS = Object.freeze({
    vega: { id: 'vega', color: '#7fe3ff', portrait: { glyph: 'ai' } },
    tim: { id: 'tim', color: '#ffc46b', portrait: { image: '/Tim Bi.webp' } },
    rhea: { id: 'rhea', color: '#9dffb0', portrait: { glyph: 'officer' } },
    umbra: { id: 'umbra', color: '#ff4f8b', portrait: { glyph: 'unknown' }, glitch: true },
});
