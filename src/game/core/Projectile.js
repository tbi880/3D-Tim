import { Vector3 } from 'three';

let nextProjectileId = 1;

/**
 * A travelling shot: an energy bolt or a homing torpedo.
 * Torpedoes can be shot down, so they share the "targetable" shape of a Ship
 * (position / radius / alive / faction / isProjectile).
 */
export class Projectile {
    constructor(kind, weaponDef, owner) {
        this.id = nextProjectileId++;
        this.kind = kind;
        this.def = weaponDef;
        this.owner = owner;
        this.faction = owner.faction;
        this.isProjectile = true;
        this.targetable = kind === 'torpedo';

        this.position = new Vector3();
        this.previousPosition = new Vector3();
        this.velocity = new Vector3();
        this.speed = weaponDef.speed;
        this.radius = weaponDef.radius ?? 1;
        this.life = weaponDef.lifetime ?? weaponDef.range / weaponDef.speed;
        this.hp = weaponDef.hp ?? 1;
        /** Damage multiplier captured at launch (player power mode). */
        this.damageScale = 1;
        this.color = weaponDef.color;
        /** Homing target (torpedoes only). */
        this.target = null;
        this.alive = true;
    }
}
