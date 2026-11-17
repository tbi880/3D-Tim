import { NET } from '../netConfig.js';

/**
 * A match snapshot (MatchServer.capture() as JSON text) as the lobby server keeps it: gzip,
 * then base64, so it fits a SignalR message (about 40 kB of JSON becomes about 4 kB). The
 * server never reads it; it hands it to the device that takes the match over.
 *
 * Both return null when they cannot (no CompressionStream in this browser, rubbish in, too big out).
 */
export async function packSnapshot(text) {
    if (typeof CompressionStream !== 'function') return null;
    try {
        const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
        return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
    } catch {
        return null;
    }
}

export async function unpackSnapshot(packed, maxLength = NET.serverSnapshotMaxUnpacked) {
    if (typeof packed !== 'string' || packed.length === 0 || typeof DecompressionStream !== 'function') return null;
    try {
        const stream = new Blob([fromBase64(packed)]).stream().pipeThrough(new DecompressionStream('gzip'));
        const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
        let text = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return text;
            text += value;
            // Whatever it says, nothing this long is a snapshot of a match.
            if (text.length > maxLength) {
                await reader.cancel().catch(() => {});
                return null;
            }
        }
    } catch {
        return null;
    }
}

function toBase64(bytes) {
    let binary = '';
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    return btoa(binary);
}

function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
