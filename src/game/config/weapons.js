/**
 * Weapon definitions. A ship class lists weapon ids from this table.
 *
 * type:
 *   'beam'    - instant-hit energy beam (drawn from `mounts`, local offsets, if given). Tracks a target inside `arcDeg` (fixed mounts) or
 *               anywhere in range (`turret: true`). `duty: [on, off]` makes AI beams pulse.
 *   'bolt'    - travelling energy bolt. `burst` shots are fired `cooldown` apart, then the
 *               weapon rests for `burstPause`.
 *   'torpedo' - slow, homing, destructible warhead.
 *   'lance'   - capital "super weapon": a telegraphed charge followed by a sweeping beam.
 *
 * shieldMult / hullMult scale damage against shields and hull, giving each weapon a job:
 * beams strip shields, torpedoes break hulls.
 */

const DAWN_BEAM = '#ffb648';
const DAWN_TORPEDO = '#7fd8ff';
const UMBRA_BOLT = '#ff3d81';
const UMBRA_BEAM = '#c04dff';
const UMBRA_TORPEDO = '#b6ff3d';

export const WEAPONS = Object.freeze({
    // ---- Player -------------------------------------------------------------------------
    playerBeam: {
        type: 'beam', range: 1300, dps: 36, arcDeg: 26, energyPerSecond: 21,
        shieldMult: 1.3, hullMult: 0.8, color: DAWN_BEAM, width: 0.34,
        // Twin emitters under the Kestrel's nose (see build_kestrel); both beams converge on the target.
        mounts: [[-3.6, -0.9, -8], [3.6, -0.9, -8]],
    },
    playerTorpedo: {
        type: 'torpedo', speed: 420, turnRate: 1.9, damage: 150, shieldMult: 0.55, hullMult: 1.5,
        lifetime: 12, cooldown: 0.7, capacity: 6, reloadTime: 4.5, lockConeDeg: 40,
        radius: 2.2, hp: 30, color: DAWN_TORPEDO, mount: [0, -1.2, -9],
    },

    // ---- Dawn fleet (allies) ------------------------------------------------------------
    dartBolt: {
        type: 'bolt', speed: 680, damage: 7, cooldown: 0.16, burst: 4, burstPause: 1.5,
        range: 900, spreadDeg: 1.4, color: DAWN_BEAM,
    },
    frigateBeam: {
        type: 'beam', turret: true, range: 1700, dps: 24, duty: [2.2, 2.4],
        shieldMult: 1.3, hullMult: 0.8, color: DAWN_BEAM, width: 3,
    },
    frigateTorpedo: {
        type: 'torpedo', turret: true, range: 3200, speed: 340, turnRate: 1.2, damage: 120,
        shieldMult: 0.55, hullMult: 1.5, lifetime: 14, cooldown: 7.5, radius: 3.4, hp: 30,
        color: DAWN_TORPEDO, targets: 'capital',
    },
    pointDefenseBeam: {
        type: 'beam', turret: true, range: 1500, dps: 40, duty: [1.6, 1.1],
        shieldMult: 1.2, hullMult: 1, color: DAWN_BEAM, width: 2, targets: 'smallFirst',
    },

    // ---- Umbra --------------------------------------------------------------------------
    droneBolt: {
        type: 'bolt', speed: 620, damage: 3.5, cooldown: 0.22, burst: 3, burstPause: 1.9,
        range: 720, spreadDeg: 2.2, color: UMBRA_BOLT,
    },
    raiderBolt: {
        type: 'bolt', speed: 660, damage: 6, cooldown: 0.17, burst: 4, burstPause: 1.9,
        range: 840, spreadDeg: 1.7, color: UMBRA_BOLT,
    },
    lancerTorpedo: {
        type: 'torpedo', range: 2400, speed: 190, turnRate: 0.9, damage: 95, shieldMult: 0.6,
        hullMult: 1.3, lifetime: 30, cooldown: 15, radius: 4.5, hp: 16, color: UMBRA_TORPEDO,
        aimConeDeg: 30,
    },
    turretBolt: {
        type: 'bolt', turret: true, speed: 600, damage: 5, cooldown: 0.3, burst: 3,
        burstPause: 2.6, range: 1700, spreadDeg: 2.6, radius: 1.6, color: UMBRA_BOLT,
    },
    eclipseCannon: {
        // Must track a target for `lockTime` seconds before firing; the HUD warns the player meanwhile.
        type: 'bolt', turret: true, speed: 560, damage: 10, cooldown: 0.22, burst: 4,
        burstPause: 3.2, range: 2600, spreadDeg: 1.1, radius: 3, color: UMBRA_BOLT, lockTime: 2,
    },
    cruiserBeam: {
        type: 'beam', turret: true, range: 1500, dps: 9, duty: [1.5, 3.4],
        shieldMult: 1.2, hullMult: 0.8, color: UMBRA_BEAM, width: 3, targets: 'capitalFirst',
    },
    eclipseLance: {
        type: 'lance', range: 16000, dps: 65, chargeTime: 4.5, fireTime: 3, cooldown: 13,
        slewRate: 0.05, corridorRadius: 120, shieldMult: 1, hullMult: 1, color: UMBRA_BEAM,
        // The emitter ball at the Eclipse's bow (the `lance` marker in modelManifest.json).
        width: 90, mount: [0, -148, -1300],
    },
});
