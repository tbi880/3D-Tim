import * as THREE from 'three';
import { randomDirection } from './ParticleSystem.js';

/**
 * What a shield does to a shot: the shot melts into the shield in a burst of light that
 * takes on the shield's colour as it spreads, and what is left of it breaks into shards
 * that skitter away across the shield's surface.
 *
 * Splashes and shards are pooled, live for a fraction of a second, and stay with the ship
 * they hit (their positions are kept relative to it). They are drawn as flares and small
 * bolts through an EnergyRibbons, so they cost no draw call of their own.
 */

export const MAX_SPLASHES = 24;
export const MAX_SHARDS = 180;
const SPLASH_SECONDS = 0.26;
const SHARD_DRAG = 3.2;

const scratchNormal = new THREE.Vector3();
const scratchTangent = new THREE.Vector3();
const scratchAlong = new THREE.Vector3();
const scratchHead = new THREE.Vector3();
const scratchTail = new THREE.Vector3();
const scratchColor = new THREE.Color();

export class ShieldImpacts {
    constructor() {
        this.splashes = Array.from({ length: MAX_SPLASHES }, () => ({
            life: 0, ship: null, offset: new THREE.Vector3(), color: new THREE.Color(), shield: new THREE.Color(), size: 1, seed: 0,
        }));
        this.shards = Array.from({ length: MAX_SHARDS }, () => ({
            life: 0, maxLife: 1, ship: null, offset: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color(), length: 1, width: 1,
        }));
        this.splashCursor = 0;
        this.shardCursor = 0;
    }

    /**
     * A shot breaks on the shield of `ship`.
     * @param {THREE.Vector3} position where on the shield (world)
     * @param {THREE.Vector3} direction the way the shot was travelling (unit)
     * @param {THREE.Color} color the shot's colour
     * @param {THREE.Color} shieldColor the shield's
     * @param {{ size: number, shards: number, speed: number }} power how large the burst is (m), and how many shards fly how fast (m/s)
     * @param {number} [scale] draws the burst and its shards this much smaller (a hit seen from close by)
     */
    strike(ship, position, direction, color, shieldColor, { size: fullSize, shards, speed }, scale = 1) {
        const size = fullSize * scale;
        const splash = this.splashes[this.splashCursor];
        this.splashCursor = (this.splashCursor + 1) % MAX_SPLASHES;
        splash.life = SPLASH_SECONDS;
        splash.ship = ship;
        splash.offset.copy(position).sub(ship.position);
        splash.color.copy(color);
        splash.shield.copy(shieldColor);
        splash.size = size;
        splash.seed = Math.random() * 6.28;

        // The shield's surface here faces away from the ship's centre; the shards leave along
        // it, carried on a little by the way the shot was going.
        scratchNormal.copy(splash.offset).normalize();
        scratchAlong.copy(direction).addScaledVector(scratchNormal, -direction.dot(scratchNormal));
        for (let n = 0; n < shards; n++) {
            const shard = this.shards[this.shardCursor];
            this.shardCursor = (this.shardCursor + 1) % MAX_SHARDS;
            randomDirection(scratchTangent);
            scratchTangent.addScaledVector(scratchNormal, -scratchTangent.dot(scratchNormal));
            if (scratchTangent.lengthSq() < 1e-6) continue;
            scratchTangent.normalize();
            shard.velocity.copy(scratchTangent).multiplyScalar(speed * (0.45 + Math.random() * 0.75))
                .addScaledVector(scratchAlong, speed * 0.45)
                .addScaledVector(scratchNormal, speed * 0.3 * Math.random());
            shard.maxLife = 0.22 + Math.random() * 0.3;
            shard.life = shard.maxLife;
            shard.ship = ship;
            shard.offset.copy(splash.offset);
            // Hot from the shot at first; some have already taken the shield's colour.
            shard.color.copy(color).lerp(shieldColor, Math.random() * 0.6);
            shard.length = size * (0.3 + Math.random() * 0.45);
            shard.width = size * (0.05 + Math.random() * 0.05);
        }
    }

    update(dt) {
        for (const splash of this.splashes) splash.life -= dt;
        const drag = Math.exp(-SHARD_DRAG * dt);
        for (const shard of this.shards) {
            if (shard.life <= 0) continue;
            shard.life -= dt;
            shard.offset.addScaledVector(shard.velocity, dt);
            shard.velocity.multiplyScalar(drag);
        }
    }

    /** Adds this frame's splashes and shards to `ribbons`. */
    draw(ribbons) {
        for (const splash of this.splashes) {
            if (splash.life <= 0) continue;
            const progress = 1 - splash.life / SPLASH_SECONDS;
            scratchHead.copy(splash.ship.position).add(splash.offset);
            // Spreads fast, then lingers as it fades into the shield.
            const radius = splash.size * (0.35 + 0.65 * Math.sqrt(progress));
            const fade = (1 - progress) ** 2;
            ribbons.flare(scratchHead, scratchColor.copy(splash.color).lerp(splash.shield, progress), 2.2 * fade, radius, 1.6 * fade, splash.seed);
        }
        for (const shard of this.shards) {
            if (shard.life <= 0) continue;
            const left = shard.life / shard.maxLife;
            const speed = shard.velocity.length();
            if (speed < 1e-3) continue;
            scratchHead.copy(shard.ship.position).add(shard.offset);
            scratchTail.copy(scratchHead).addScaledVector(shard.velocity, -shard.length * (0.4 + 0.6 * left) / speed);
            ribbons.bolt(scratchTail, scratchHead, shard.color, 2.4 * left, shard.width, 1.2 * left);
        }
    }

    clear() {
        for (const splash of this.splashes) splash.life = 0;
        for (const shard of this.shards) shard.life = 0;
    }
}
