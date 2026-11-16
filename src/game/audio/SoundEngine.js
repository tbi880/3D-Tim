import { MUSIC_TRACKS } from '../config/gameConfig.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { SESSION_EVENTS } from '../state/GameSession.js';
import { WarpArrivalAudio } from './WarpArrivalAudio.js';

/**
 * All game audio. Sound effects are synthesised with the Web Audio API (no asset files to
 * ship or host); music reuses the site's existing soundtrack from the asset bucket.
 *
 * Browsers only allow audio after a user gesture, so nothing plays until `unlock()` is
 * called from a click / key handler.
 */

const MASTER_VOLUME = 0.5;
const MUSIC_VOLUME = 0.32;
const MUSIC_FADE_SECONDS = 1.5;
/** Sounds further than this from the player are not played at all. */
const HEARING_RANGE = 2600;

export class SoundEngine {
    /** @param {{ assetBaseUrl: string }} params base URL of the site's asset bucket */
    constructor({ assetBaseUrl }) {
        this.assetBaseUrl = assetBaseUrl;
        this.context = null;
        this.master = null;
        this.noiseBuffer = null;
        this.muted = false;
        this.session = null;
        this.unsubscribe = [];
        this.beamVoice = null;
        this.engineVoice = null;
        this.music = null;
        this.musicTrackId = null;
        this.fadeTimers = new Set();
        /** Ships dropping out of warp nearby, heard in 3D (WarpArrivalAudio.js). */
        this.arrivals = new WarpArrivalAudio(this);
    }

    // ---- Setup --------------------------------------------------------------------------

    /** Creates the audio graph. Must be called from a user gesture. Safe to call repeatedly. */
    unlock() {
        if (this.context) {
            if (this.context.state === 'suspended') this.context.resume();
            return;
        }
        const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
        if (!AudioContextClass) return;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
        this.master.connect(this.context.destination);
        this.noiseBuffer = this.createNoiseBuffer();
        this.beamVoice = this.createBeamVoice();
        this.engineVoice = this.createEngineVoice();
        if (this.musicTrackId) this.startMusic(this.musicTrackId);
    }

    /** @param {import('../state/GameSession.js').GameSession} session */
    attach(session) {
        this.session = session;
        const world = session.world.events;
        const stage = session.events;
        this.unsubscribe = [
            world.on(GAME_EVENTS.WEAPON_FIRED, (event) => this.onWeaponFired(event)),
            world.on(GAME_EVENTS.EXPLOSION, (event) => this.onExplosion(event)),
            world.on(GAME_EVENTS.HIT, (event) => this.onHit(event)),
            world.on(GAME_EVENTS.PLAYER_COLLISION, ({ ship }) => this.isOwnShip(ship) && this.thud(0.5)),
            world.on(GAME_EVENTS.TARGET_CHANGED, ({ target }) => target && this.tone({ from: 1250, to: 1250, duration: 0.05, gain: 0.12, type: 'square' })),
            world.on(GAME_EVENTS.WEAPON_EMPTY, ({ ship }) => this.isOwnShip(ship) && this.tone({ from: 160, to: 120, duration: 0.12, gain: 0.15, type: 'square' })),
            world.on(GAME_EVENTS.LANCE_CHARGING, ({ weapon }) => this.tone({ from: 60, to: 520, duration: weapon.def.chargeTime, gain: 0.16, type: 'sawtooth' })),
            world.on(GAME_EVENTS.LANCE_FIRING, ({ weapon }) => this.noise({ duration: weapon.def.fireTime, frequency: 240, gain: 0.5 })),
            world.on(GAME_EVENTS.WARP_IN_STARTED, ({ ship }) => this.arrivals.onStart(ship)),
            world.on(GAME_EVENTS.WARP_FLASH, ({ position, ship }) => {
                if (ship) this.arrivals.onLanding(ship);
                else this.noise({ duration: 0.7, frequency: 900, gain: 0.25 * this.attenuation(position) });
            }),
            stage.on(SESSION_EVENTS.CUE, ({ id }) => this.playCue(id)),
            stage.on(SESSION_EVENTS.MUSIC, ({ id }) => this.setMusic(id)),
            stage.on(SESSION_EVENTS.WARP, ({ stage: warpStage }) => this.onWarp(warpStage)),
            stage.on(SESSION_EVENTS.COMMS, ({ line }) => line && this.commsChirp()),
            stage.on(SESSION_EVENTS.CHECKPOINT, () => this.chime()),
            stage.on(SESSION_EVENTS.SETTINGS, ({ settings }) => this.setMuted(settings.muted)),
        ];
        this.setMuted(session.settings.muted);
    }

    dispose() {
        for (const unsubscribe of this.unsubscribe) unsubscribe();
        this.unsubscribe = [];
        for (const timer of this.fadeTimers) clearInterval(timer);
        this.fadeTimers.clear();
        this.arrivals.dispose();
        if (this.music) {
            this.music.pause();
            this.music.src = '';
            this.music = null;
        }
        this.context?.close();
        this.context = null;
    }

    setMuted(muted) {
        this.muted = muted;
        if (this.master) this.master.gain.value = muted ? 0 : MASTER_VOLUME;
        if (this.music) this.music.volume = muted ? 0 : MUSIC_VOLUME;
    }

    // ---- Building blocks ----------------------------------------------------------------

    createNoiseBuffer() {
        const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    /** A pitched blip that glides from `from` Hz to `to` Hz. */
    tone({ from, to, duration, gain, type = 'sine', delay = 0 }) {
        if (!this.context || gain <= 0.001) return;
        const start = this.context.currentTime + delay;
        const oscillator = this.context.createOscillator();
        const envelope = this.context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(from, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, duration / 4));
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(envelope).connect(this.master);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.05);
    }

    /** A burst of low-pass filtered noise (explosions, impacts, whooshes). */
    noise({ duration, frequency, gain, delay = 0 }) {
        if (!this.context || gain <= 0.001) return;
        const start = this.context.currentTime + delay;
        const source = this.context.createBufferSource();
        const filter = this.context.createBiquadFilter();
        const envelope = this.context.createGain();
        source.buffer = this.noiseBuffer;
        source.loop = true;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency, start);
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.2), start + duration);
        envelope.gain.setValueAtTime(gain, start);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.connect(filter).connect(envelope).connect(this.master);
        source.start(start);
        source.stop(start + duration + 0.05);
    }

    thud(gain) {
        this.tone({ from: 130, to: 45, duration: 0.25, gain, type: 'sine' });
        this.noise({ duration: 0.2, frequency: 500, gain: gain * 0.6 });
    }

    /** 0..1 loudness for something happening at `position`, by distance from the player. */
    attenuation(position) {
        const player = this.session?.world.player;
        if (!player || !position) return 1;
        const distance = player.position.distanceTo(position);
        return Math.max(0, 1 - distance / HEARING_RANGE) ** 2;
    }

    createBeamVoice() {
        const oscillator = this.context.createOscillator();
        const wobble = this.context.createOscillator();
        const wobbleDepth = this.context.createGain();
        const gain = this.context.createGain();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 310;
        wobble.frequency.value = 23;
        wobbleDepth.gain.value = 28;
        gain.gain.value = 0;
        wobble.connect(wobbleDepth).connect(oscillator.frequency);
        oscillator.connect(gain).connect(this.master);
        oscillator.start();
        wobble.start();
        return gain;
    }

    createEngineVoice() {
        const source = this.context.createBufferSource();
        const filter = this.context.createBiquadFilter();
        const gain = this.context.createGain();
        source.buffer = this.noiseBuffer;
        source.loop = true;
        filter.type = 'lowpass';
        filter.frequency.value = 120;
        gain.gain.value = 0;
        source.connect(filter).connect(gain).connect(this.master);
        source.start();
        return { gain, filter };
    }

    // ---- Event handlers -----------------------------------------------------------------

    /** True for the ship flown on this device (in multiplayer other players' ships are `isPlayer` too). */
    isOwnShip(ship) {
        return Boolean(ship) && ship === this.session?.world.player;
    }

    onWeaponFired({ ship, kind }) {
        if (kind === 'torpedo') {
            const loudness = this.isOwnShip(ship) ? 1 : this.attenuation(ship.position);
            this.tone({ from: 240, to: 70, duration: 0.5, gain: 0.3 * loudness });
            this.noise({ duration: 0.45, frequency: 1400, gain: 0.2 * loudness });
            return;
        }
        this.tone({ from: 1000, to: 280, duration: 0.11, gain: 0.07 * this.attenuation(ship.position), type: 'square' });
    }

    onExplosion({ position, size, capital }) {
        const loudness = this.attenuation(position) * (capital ? 1.6 : 1);
        const scale = Math.min(1, size / 80);
        this.noise({ duration: 0.5 + scale * 2, frequency: 900 - scale * 500, gain: (0.35 + scale * 0.5) * loudness });
        this.tone({ from: 110, to: 30, duration: 0.5 + scale, gain: 0.3 * loudness });
    }

    onHit({ target, shield, amount }) {
        if (!this.isOwnShip(target) || amount <= 0) return;
        if (shield) this.tone({ from: 1500, to: 500, duration: 0.14, gain: 0.14, type: 'triangle' });
        else this.thud(0.35);
    }

    onWarp(stage) {
        if (stage === 'spool') this.tone({ from: 70, to: 1400, duration: 2.4, gain: 0.25, type: 'sawtooth' });
        else this.noise({ duration: 1.6, frequency: 1800, gain: 0.5 });
    }

    commsChirp() {
        this.tone({ from: 880, to: 880, duration: 0.06, gain: 0.08 });
        this.tone({ from: 1320, to: 1320, duration: 0.08, gain: 0.08, delay: 0.08 });
    }

    chime() {
        this.tone({ from: 660, to: 660, duration: 0.25, gain: 0.12 });
        this.tone({ from: 990, to: 990, duration: 0.4, gain: 0.12, delay: 0.16 });
    }

    playCue(id) {
        switch (id) {
            case 'alarm':
                for (let i = 0; i < 3; i++) {
                    this.tone({ from: 620, to: 620, duration: 0.22, gain: 0.16, type: 'square', delay: i * 0.5 });
                    this.tone({ from: 470, to: 470, duration: 0.22, gain: 0.16, type: 'square', delay: i * 0.5 + 0.24 });
                }
                break;
            case 'power':
                this.tone({ from: 500, to: 900, duration: 0.12, gain: 0.1, type: 'triangle' });
                break;
            // Multiplayer: the story before a match, and its two endings.
            case 'matchIntro':
                // A low swell under the opening lines.
                this.tone({ from: 55, to: 82, duration: 6, gain: 0.22, type: 'sawtooth' });
                this.noise({ duration: 5, frequency: 300, gain: 0.18 });
                break;
            case 'victory': {
                // A rising fanfare, then the drive winding up for the jump through the gate.
                const fanfare = [392, 523, 659, 784, 1047];
                fanfare.forEach((pitch, index) => {
                    this.tone({ from: pitch, to: pitch, duration: index === fanfare.length - 1 ? 1.4 : 0.32, gain: 0.2, type: 'triangle', delay: index * 0.24 });
                    this.tone({ from: pitch / 2, to: pitch / 2, duration: 0.4, gain: 0.12, type: 'sine', delay: index * 0.24 });
                });
                this.tone({ from: 70, to: 1600, duration: 3.2, gain: 0.2, type: 'sawtooth', delay: 1.6 });
                break;
            }
            case 'defeat':
                // The star going out: a long fall and a rumble.
                this.tone({ from: 220, to: 36, duration: 4.5, gain: 0.3, type: 'sawtooth' });
                this.noise({ duration: 4.8, frequency: 180, gain: 0.45, delay: 0.3 });
                break;
            case 'dawnCannon':
                this.tone({ from: 90, to: 1800, duration: 0.9, gain: 0.3, type: 'sawtooth' });
                this.noise({ duration: 3.4, frequency: 2600, gain: 0.7, delay: 0.3 });
                this.tone({ from: 160, to: 40, duration: 3, gain: 0.4, delay: 0.3 });
                break;
            default: break;
        }
    }

    // ---- Per-frame ----------------------------------------------------------------------

    /** Keeps the continuous voices (beam hum, engine rumble) in step with the player's ship. */
    update(world, active) {
        if (!this.context) return;
        const now = this.context.currentTime;
        const player = world.player;
        const flying = active && player?.alive;
        const speedFraction = flying ? Math.min(1.5, player.speed / player.cls.maxSpeed) : 0;
        this.beamVoice.gain.setTargetAtTime(flying && player.beamFiring ? 0.07 : 0, now, 0.03);
        this.engineVoice.gain.gain.setTargetAtTime(flying ? 0.1 + speedFraction * 0.22 : 0, now, 0.2);
        this.engineVoice.filter.frequency.setTargetAtTime(90 + speedFraction * 260, now, 0.2);
        this.arrivals.update(world);
    }

    // ---- Music --------------------------------------------------------------------------

    setMusic(trackId) {
        if (trackId === this.musicTrackId) return;
        this.musicTrackId = trackId;
        if (this.context) this.startMusic(trackId);
    }

    startMusic(trackId) {
        const previous = this.music;
        if (previous) this.fade(previous, 0, () => { previous.pause(); previous.src = ''; });
        this.music = null;
        const file = MUSIC_TRACKS[trackId];
        if (!file) return;
        const audio = new Audio(this.assetBaseUrl + file);
        audio.loop = true;
        audio.volume = 0;
        audio.play().catch(() => { /* Autoplay refused or file missing: the game works without music. */ });
        this.music = audio;
        this.fade(audio, this.muted ? 0 : MUSIC_VOLUME);
    }

    fade(audio, targetVolume, onDone) {
        const steps = 15;
        const delta = (targetVolume - audio.volume) / steps;
        let remaining = steps;
        const timer = setInterval(() => {
            remaining -= 1;
            audio.volume = Math.min(1, Math.max(0, remaining <= 0 ? targetVolume : audio.volume + delta));
            if (remaining > 0) return;
            clearInterval(timer);
            this.fadeTimers.delete(timer);
            onDone?.();
        }, (MUSIC_FADE_SECONDS * 1000) / steps);
        this.fadeTimers.add(timer);
    }
}
