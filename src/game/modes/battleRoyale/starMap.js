/**
 * The planets of a star system in orbit order, and the one rule of travel between them:
 * a jump reaches the next orbit in or out, never further.
 */
export class StarMap {
    /** @param {{ id: string, planets: { id: string, sectorId: string, gate?: boolean }[] }} system innermost planet first */
    constructor(system) {
        this.id = system.id;
        this.planets = system.planets;
        this.orbitOf = new Map(system.planets.map((planet, orbit) => [planet.id, orbit]));
    }

    get count() {
        return this.planets.length;
    }

    has(planetId) {
        return this.orbitOf.has(planetId);
    }

    planet(planetId) {
        return this.planets[this.orbitOf.get(planetId)] ?? null;
    }

    /** The outermost planet: where the stargate is. */
    get gate() {
        return this.planets[this.planets.length - 1];
    }

    /** True when `to` is on the orbit next to `from`'s. */
    areNeighbours(from, to) {
        if (!this.has(from) || !this.has(to)) return false;
        return Math.abs(this.orbitOf.get(from) - this.orbitOf.get(to)) === 1;
    }

    /** Ids of the planets a ship at `planetId` can jump to (one or two). */
    neighbours(planetId) {
        const orbit = this.orbitOf.get(planetId);
        if (orbit === undefined) return [];
        return [this.planets[orbit - 1], this.planets[orbit + 1]].filter(Boolean).map((planet) => planet.id);
    }
}
