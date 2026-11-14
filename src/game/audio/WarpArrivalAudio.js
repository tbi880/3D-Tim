import { Quaternion, Vector3 } from 'three';
import { FACTION } from '../config/gameConfig.js';
import { forwardOf } from '../core/math.js';
import { WARP_IN_DISTANCE, arrivalHeft, warpDisplacement } from '../scene/effects/warpPath.js';

/**
 * The sound of ships dropping out of warp around the player, placed in 3D so you can tell
 * where they are without looking (headphones help: the panners use HRTF).
 *
 *  Inbound - a rising, tearing hiss and a falling whine that come in from behind the
 *            arriving ship and swell until it stops (the sound follows the streak).
 *  Landing - a crack, a deep "whump" that sinks in pitch, a burst of rushing air and a glassy,
 *            inharmonic ring as the warp field lets go. Big ships add a long rumble and can be
 *            heard much further away; far-off arrivals are muffled.
 *
 * Everything is synthesised (Web Audio), nothing is sampled. Fighters arriving in a swarm
 * are thinned out so a squadron sounds like a squadron, not like a hailstorm.
 */

/** Hearing range (m) for a fighter's arrival; the largest ships carry four times as far. */
const BASE_RANGE = 3200;
const MAX_VOICES = 14;
/** Fighters landing closer together than this (s) share one landing sound. */
const SMALL_LANDING_GAP = 0.09;
const MAX_SMALL_INBOUND = 3;

/** Base pitch of the landing ring per fleet: Dawn bright, Umbra darker and rougher. */
const RING_PITCH = Object.freeze({ [FACTION.DAWN]: 560, [FACTION.UMBRA]: 330, [FACTION.NEUTRAL]: 440 });
const RING_RATIOS = [1, 1.49, 2.37];

const scratchInverse = new Quaternion();
const scratchLocal = new Vector3();
const scratchForward = new Vector3();

export class WarpArrivalAudio {
    /** @param {import('./SoundEngine.js').SoundEngine} engine */
    constructor(engine) {
        this.engine = engine;
        /** Arrivals that started since the last frame: their sound is set up on the next update. */
        this.pending = [];
        this.voices = [];
        this.lastSmallLandingAt = -Infinity;
    }

    get context() {
        return this.engine.context;
    }

    range(heft) {
        return BASE_RANGE * (1 + 3 * heft);
    }

    // ---- Events ---------------------------------------------------------------------------

    onStart(ship) {
        if (!this.context) return;
        // Placed on the next frame: ships that jump with the player only get their new position after this event.
        this.pending.push(ship);
    }

    onLanding(ship) {
        const context = this.context;
        const player = this.engine.session?.world.player;
        if (!context || !player) return;
        const heft = arrivalHeft(ship);
        const distance = player.position.distanceTo(ship.position);
        const range = this.range(heft);
        if (distance > range || this.voices.length >= MAX_VOICES) return;
        const now = context.currentTime;
        if (heft < 0.3) {
            if (now - this.lastSmallLandingAt < SMALL_LANDING_GAP) return;
            this.lastSmallLandingAt = now;
        }
        const tail = 1.6 + heft * 5;
        const voice = this.createVoice(ship, false, heft, tail);
        this.playLanding(voice.input, ship, heft, now);
    }

    // ---- Per frame ------------------------------------------------------------------------

    update(world) {
        const context = this.context;
        if (!context) return;
        const now = context.currentTime;
        const player = world.player;

        if (this.pending.length > 0) {
            const started = this.pending;
            this.pending = [];
            for (const ship of started) {
                if (ship.alive && ship.warpTimer > 0.15 && player) this.startInbound(ship, player, now);
            }
        }

        this.voices = this.voices.filter((voice) => {
            if (now > voice.endAt) {
                voice.input.disconnect();
                voice.output.disconnect();
                return false;
            }
            // An inbound voice whose ship vanished mid-arrival fades out.
            if (voice.inbound && !voice.ship.alive && !voice.cut) {
                voice.cut = true;
                voice.input.gain.setTargetAtTime(0, now, 0.05);
                voice.endAt = Math.min(voice.endAt, now + 0.3);
            }
            this.place(voice, player, now);
            return true;
        });
    }

    dispose() {
        this.pending = [];
        this.voices = [];
    }

    // ---- Voices ---------------------------------------------------------------------------

    /**
     * A sound source in space: input -> air (muffles with distance) -> loudness -> panner -> master.
     * Distance loudness is done by hand (the panner only supplies direction), so it matches the
     * rest of the game's sounds and the range can depend on the size of the ship.
     */
    createVoice(ship, inbound, heft, seconds) {
        const context = this.context;
        const input = context.createGain();
        const air = context.createBiquadFilter();
        const loudness = context.createGain();
        const panner = context.createPanner();
        air.type = 'lowpass';
        air.Q.value = 0.4;
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.rolloffFactor = 0;
        input.connect(air).connect(loudness).connect(panner).connect(this.engine.master);
        const voice = {
            ship, inbound, heft, input, air, loudness, panner, output: panner,
            range: this.range(heft), endAt: context.currentTime + seconds + 0.3, cut: false, placed: false,
        };
        this.place(voice, this.engine.session?.world.player, context.currentTime);
        this.voices.push(voice);
        return voice;
    }

    /** Points the voice's panner at the ship (relative to the player's heading) and sets its loudness. */
    place(voice, player, now) {
        const ship = voice.ship;
        scratchLocal.copy(ship.position);
        if (voice.inbound && ship.warpTimer > 0) {
            // Follow the streak, not the spot it is heading for.
            forwardOf(ship.quaternion, scratchForward);
            scratchLocal.addScaledVector(scratchForward, warpDisplacement(ship) * WARP_IN_DISTANCE);
        }
        let distance = 0;
        if (player) {
            scratchLocal.sub(player.position);
            distance = scratchLocal.length();
            scratchLocal.applyQuaternion(scratchInverse.copy(player.quaternion).invert());
        }
        if (distance < 1) scratchLocal.set(0, 0, -1);
        else scratchLocal.divideScalar(distance);

        const near = Math.max(0, 1 - distance / voice.range);
        const gain = near * near;
        const cutoff = 500 + 17500 * near * near * near;
        const { panner } = voice;
        if (!voice.placed) {
            voice.placed = true;
            voice.loudness.gain.setValueAtTime(gain, now);
            voice.air.frequency.setValueAtTime(cutoff, now);
            setPannerPosition(panner, scratchLocal, null);
            return;
        }
        voice.loudness.gain.setTargetAtTime(gain, now, 0.05);
        voice.air.frequency.setTargetAtTime(cutoff, now, 0.05);
        setPannerPosition(panner, scratchLocal, now);
    }

    // ---- Sounds ---------------------------------------------------------------------------

    startInbound(ship, player, now) {
        const heft = arrivalHeft(ship);
        if (player.position.distanceTo(ship.position) > this.range(heft) * 1.2) return;
        if (this.voices.length >= MAX_VOICES) return;
        if (heft < 0.3 && this.voices.filter((voice) => voice.inbound && voice.heft < 0.3).length >= MAX_SMALL_INBOUND) return;

        const duration = ship.warpTimer;
        const voice = this.createVoice(ship, true, heft, duration + 0.1);
        const out = voice.input;
        const end = now + duration;
        const peak = 0.1 + heft * 0.16;

        // Tearing hiss: band-passed noise sweeping down as the ship brakes, swelling to the end.
        const hiss = this.noiseSource();
        const band = this.context.createBiquadFilter();
        const hissGain = this.context.createGain();
        band.type = 'bandpass';
        band.Q.value = 1.4;
        band.frequency.setValueAtTime(4200 - heft * 1500, now);
        band.frequency.exponentialRampToValueAtTime(320 - heft * 180, end);
        envelopeSwell(hissGain.gain, now, end, peak);
        hiss.connect(band).connect(hissGain).connect(out);
        hiss.start(now);
        hiss.stop(end + 0.08);

        // Falling whine with a slight warble, like something huge decelerating past.
        const whine = this.context.createOscillator();
        const warble = this.context.createOscillator();
        const warbleDepth = this.context.createGain();
        const whineGain = this.context.createGain();
        const fromHz = 1500 - heft * 1000;
        const toHz = 160 - heft * 110;
        whine.type = 'triangle';
        whine.frequency.setValueAtTime(fromHz, now);
        whine.frequency.exponentialRampToValueAtTime(toHz, end);
        warble.frequency.value = 7 + Math.random() * 4;
        warbleDepth.gain.value = fromHz * 0.015;
        envelopeSwell(whineGain.gain, now, end, peak * 0.55);
        warble.connect(warbleDepth).connect(whine.frequency);
        whine.connect(whineGain).connect(out);
        whine.start(now);
        warble.start(now);
        whine.stop(end + 0.08);
        warble.stop(end + 0.08);

        // Big hulls push a wall of low pressure ahead of them.
        if (heft > 0.4) {
            const swell = this.context.createOscillator();
            const swellGain = this.context.createGain();
            swell.type = 'sine';
            swell.frequency.setValueAtTime(52, now);
            swell.frequency.exponentialRampToValueAtTime(34, end);
            envelopeSwell(swellGain.gain, now, end, 0.25 * heft);
            swell.connect(swellGain).connect(out);
            swell.start(now);
            swell.stop(end + 0.08);
        }
    }

    playLanding(out, ship, heft, now) {
        const context = this.context;
        // Crack: the instant the bubble collapses.
        this.noiseBurst(out, now, { type: 'highpass', from: 2600, to: 2600, duration: 0.07 + heft * 0.05, gain: 0.3 + heft * 0.15, attack: 0.002 });
        // Whump: a falling sine, longer and deeper for larger hulls.
        const boom = context.createOscillator();
        const boomGain = context.createGain();
        const boomLength = 0.55 + heft * 2.4;
        boom.type = 'sine';
        boom.frequency.setValueAtTime(95 - heft * 40, now);
        boom.frequency.exponentialRampToValueAtTime(30 - heft * 8, now + boomLength);
        boomGain.gain.setValueAtTime(0.0001, now);
        boomGain.gain.exponentialRampToValueAtTime(0.32 + heft * 0.45, now + 0.015);
        boomGain.gain.exponentialRampToValueAtTime(0.0001, now + boomLength);
        boom.connect(boomGain).connect(out);
        boom.start(now);
        boom.stop(now + boomLength + 0.05);
        // Displaced air rushing back in.
        this.noiseBurst(out, now, { type: 'lowpass', from: 1400, to: 110, duration: 0.5 + heft * 2, gain: 0.22 + heft * 0.28, attack: 0.01 });
        // The warp field ringing down: three inharmonic partials, gliding a little flat as they fade.
        const base = (RING_PITCH[ship.faction] ?? RING_PITCH[FACTION.NEUTRAL]) * (1 - heft * 0.4);
        const ringLength = 1.1 + heft * 2.2;
        RING_RATIOS.forEach((ratio, index) => {
            const partial = context.createOscillator();
            const partialGain = context.createGain();
            const start = now + 0.02 + index * 0.015;
            const hz = base * ratio * (1 + (Math.random() - 0.5) * 0.01);
            partial.type = ship.faction === FACTION.UMBRA && index === 0 ? 'triangle' : 'sine';
            partial.frequency.setValueAtTime(hz, start);
            partial.frequency.exponentialRampToValueAtTime(hz * 0.95, start + ringLength);
            partialGain.gain.setValueAtTime(0.0001, start);
            partialGain.gain.exponentialRampToValueAtTime((0.06 - index * 0.012) * (0.8 + heft * 0.5), start + 0.03);
            partialGain.gain.exponentialRampToValueAtTime(0.0001, start + ringLength / (1 + index * 0.4));
            partial.connect(partialGain).connect(out);
            partial.start(start);
            partial.stop(start + ringLength + 0.05);
        });
        // Capital ships: a long rolling rumble that settles over several seconds.
        if (heft > 0.4) {
            this.noiseBurst(out, now + 0.05, { type: 'lowpass', from: 170, to: 60, duration: 2.5 + heft * 2.5, gain: 0.35 * heft, attack: 0.35 });
        }
    }

    noiseSource() {
        const source = this.context.createBufferSource();
        source.buffer = this.engine.noiseBuffer;
        source.loop = true;
        return source;
    }

    noiseBurst(out, start, { type, from, to, duration, gain, attack }) {
        const context = this.context;
        const source = this.noiseSource();
        const filter = context.createBiquadFilter();
        const envelope = context.createGain();
        filter.type = type;
        filter.frequency.setValueAtTime(from, start);
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.connect(filter).connect(envelope).connect(out);
        // From a random point in the buffer, so overlapping arrivals do not phase into each other.
        source.start(start, Math.random() * 1.5);
        source.stop(start + duration + 0.05);
    }
}

/** Quiet at first, then a steep swell into `end` (the moment of arrival). */
function envelopeSwell(param, start, end, peak) {
    const length = Math.max(0.05, end - start);
    param.setValueAtTime(0.0001, start);
    param.exponentialRampToValueAtTime(peak * 0.12, start + length * 0.55);
    param.exponentialRampToValueAtTime(peak, end);
    param.exponentialRampToValueAtTime(0.0001, end + 0.06);
}

/** Moves a panner (older Safari only has setPosition). `now` null = jump straight there. */
function setPannerPosition(panner, position, now) {
    if (panner.positionX) {
        if (now == null) {
            panner.positionX.value = position.x;
            panner.positionY.value = position.y;
            panner.positionZ.value = position.z;
        } else {
            panner.positionX.setTargetAtTime(position.x, now, 0.03);
            panner.positionY.setTargetAtTime(position.y, now, 0.03);
            panner.positionZ.setTargetAtTime(position.z, now, 0.03);
        }
    } else {
        panner.setPosition(position.x, position.y, position.z);
    }
}
