import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MATCH_PHASE } from '../../src/game/net/match/matchState.js';
import { MENU_PLACE, MENU_POSITION, isMenuShown, matchMenuPlace } from '../../src/game/xr/menuPlacement.js';

/**
 * Whether the VR menu panel is shown (xr/menuPlacement.js). A match's ending plays straight
 * ahead and nothing is put over it; the result comes up in front once it is over.
 */

const PLAYING = { phase: MATCH_PHASE.PLAYING, winner: null };
const OVER = { phase: MATCH_PHASE.OVER, winner: 'dawn' };
const OUTCOMES = [{ winner: 'dawn', won: true }, { winner: 'dawn', won: false }, { winner: null, won: false }];

test('nothing is shown over a match\'s ending, whoever won, in either act', () => {
    for (const act of ['gate', 'fall']) {
        for (const outro of OUTCOMES) {
            const place = matchMenuPlace({ match: OVER, matchOutro: { ...outro, act } }, false);
            assert.equal(place, MENU_PLACE.NONE, `${act} ${JSON.stringify(outro)}`);
            assert.equal(isMenuShown(place), false);
        }
    }
});

test('once the ending is over the result comes up in front, as every other menu does', () => {
    for (const winner of ['dawn', null]) {
        const place = matchMenuPlace({ match: { phase: MATCH_PHASE.OVER, winner }, matchOutro: null }, true);
        assert.equal(place, MENU_PLACE.FRONT);
        assert.equal(isMenuShown(place), true);
    }
    assert.equal(matchMenuPlace({ match: { phase: MATCH_PHASE.DISCONNECTED }, matchOutro: null }, true), MENU_PLACE.FRONT, 'a lost link, with no ending');
    assert.equal(matchMenuPlace({ match: PLAYING, matchOutro: null }, false), MENU_PLACE.FRONT, 'the map, the intro, a pilot who is down');
    assert.equal(matchMenuPlace({ match: null, matchOutro: null }, false), MENU_PLACE.FRONT, 'outside a match');
    assert.ok(MENU_POSITION[2] < -1 && Math.abs(MENU_POSITION[0]) < 1e-9, 'in front of the eye');
});
