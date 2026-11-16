import { DIFFICULTY_ORDER } from '../config/gameConfig.js';
import { PLAYER_SHIPS, RATING_MAX, RATING_ORDER } from '../config/playerShips.js';
import { mergeUpgrades, upgradedRatings } from '../core/refit.js';
import { LOCALES, LOCALE_LABELS } from '../i18n/index.js';
import { playerModelFile, requestShipModel } from '../scene/models/ShipModel.jsx';
import { PHASE } from '../state/GameSession.js';
import { loadSave } from '../state/saveGame.js';
import { roundRect, wrapText } from './canvasPanel.js';
import { buildMatchMenu, isMatchMenuOpen } from './VRMatchMenu.js';
import { vrPerformance } from './vrPerformance.js';
import { exitVR, vr } from './vrState.js';

/**
 * The menus inside the headset: title, pause, game over, ending and the refit window, as one
 * list of rows on a panel in front of the pilot. The flat page's menus (ui/Menus.jsx) cannot
 * be seen in VR; these offer the same choices, driven by the controller sticks and buttons.
 *
 * A row is { label, sub?, value?, select?, left?, right?, disabled? }: `select` runs on
 * trigger / A, `left` / `right` change the row's value.
 */

const cycle = (list, current, step) => list[(list.indexOf(current) + step + list.length) % list.length];

/** The ship a saved game continues with (as World.restore picks it). */
function savedShipClass(fallback) {
    const classId = loadSave()?.world?.player?.classId;
    return playerModelFile(classId) ? classId : fallback;
}

export class VRMenu {
    /** @param {{ session: import('../state/GameSession.js').GameSession, sound: { unlock(): void }, lan: object }} game */
    constructor(game) {
        this.game = game;
        this.index = 0;
        /** Title screen: the player has opened the LAN lobby (xr/VRMatchMenu.js). */
        this.lobbyOpen = false;
        /** Title screen: the game being started while its ship model loads ({ classId, start }). */
        this.launch = null;
        this.confirmingNewGame = false;
        /** Refit window: levels added so far ({ rating: levels }). */
        this.refitAdded = {};
        this.lastKey = null;
        this.dirty = true;
    }

    /** True when a menu should be on screen (VR shows no flat menus). */
    isOpen(state) {
        const phase = this.game.session.phase;
        return phase !== PHASE.PLAYING || Boolean(state.refit) || isMatchMenuOpen(state);
    }

    /** Called every frame while open: starts a launched game once its ship is in. */
    tick(state) {
        if (!this.launch) return;
        if (this.game.session.phase !== PHASE.TITLE) {
            this.launch = null;
            return;
        }
        const status = state.shipLoad?.classId === this.launch.classId ? state.shipLoad.status : 'loading';
        if (status === 'ready') {
            const { start } = this.launch;
            this.launch = null;
            start();
        }
    }

    /** The menu for the current state: { key, title, lines, items }. */
    build(state, t) {
        const { session } = this.game;
        const settings = state.settings;
        const exitItem = { label: t('ui.vr.exit'), select: () => exitVR() };

        if (state.refit && session.phase === PHASE.PLAYING) return this.buildRefit(state, t);
        if (!state.refit) this.refitAdded = {};

        // Multiplayer has menus of its own: the lobby, and in a match the map, the vote and the result.
        const matchMenu = buildMatchMenu(this.game, state, t, { lobbyOpen: this.lobbyOpen, setLobbyOpen: (open) => { this.lobbyOpen = open; } });
        if (matchMenu) return matchMenu;

        switch (session.phase) {
            case PHASE.TITLE: {
                if (this.launch) {
                    const { classId } = this.launch;
                    const failed = state.shipLoad?.classId === classId && state.shipLoad.status === 'failed';
                    const ship = t(`ship.${classId}`);
                    return {
                        key: `launch:${failed}`,
                        title: t('ui.title'),
                        lines: [failed ? t('ui.hangar.loadFailed', { ship }) : t('ui.hangar.loading', { ship })],
                        items: [
                            ...(failed ? [{ label: t('ui.hangar.retry'), select: () => requestShipModel(classId) }] : []),
                            { label: t('ui.back'), select: () => { this.launch = null; } },
                        ],
                    };
                }
                const begin = (classId, start) => {
                    this.game.sound.unlock();
                    requestShipModel(classId);
                    this.launch = { classId, start };
                    this.confirmingNewGame = false;
                };
                const items = [];
                if (state.hasSave) {
                    items.push({
                        label: t('ui.continue'),
                        sub: t('ui.continueFrom', { checkpoint: t(`checkpoint.${state.saveCheckpointId}`) }),
                        select: () => begin(savedShipClass(settings.playerShip), () => session.continueGame()),
                    });
                }
                items.push({
                    label: t('ui.newGame'),
                    sub: this.confirmingNewGame ? t('ui.confirmNewGame') : null,
                    select: () => {
                        if (state.hasSave && !this.confirmingNewGame) {
                            this.confirmingNewGame = true;
                            return;
                        }
                        begin(settings.playerShip, () => session.newGame());
                    },
                });
                const ships = PLAYER_SHIPS.map((ship) => ship.classId);
                const shipRow = (step) => () => session.updateSettings({ playerShip: cycle(ships, settings.playerShip, step) });
                items.push({ label: t('ui.vr.ship'), sub: t(`playerShip.${settings.playerShip}.role`), value: t(`ship.${settings.playerShip}`), left: shipRow(-1), right: shipRow(1), select: shipRow(1) });
                const difficultyRow = (step) => () => session.updateSettings({ difficulty: cycle(DIFFICULTY_ORDER, settings.difficulty, step) });
                items.push({ label: t('ui.difficulty'), value: t(`ui.difficulty.${settings.difficulty}`), left: difficultyRow(-1), right: difficultyRow(1), select: difficultyRow(1) });
                items.push({
                    label: t('mp.lan.open'),
                    sub: t('mp.lan.openHint'),
                    select: () => {
                        this.lobbyOpen = true;
                        this.game.lan.open();
                    },
                });
                items.push(...this.commonSettings(settings, t));
                items.push(exitItem);
                return { key: 'title', title: t('ui.title'), lines: [t('ui.tagline')], items };
            }
            case PHASE.PAUSED: {
                const items = [{ label: t('ui.resume'), select: () => session.resume() }];
                if (state.hasSave) items.push({ label: t('ui.restartCheckpoint'), select: () => session.continueGame() });
                const toggleView = () => { vr.view = vr.view === 'chase' ? 'cockpit' : 'chase'; };
                items.push({ label: t('ui.view'), value: t(`ui.view.${vr.view}`), left: toggleView, right: toggleView, select: toggleView });
                items.push(...this.commonSettings(settings, t));
                items.push({ label: t('ui.quitToTitle'), select: () => session.enterTitle() });
                items.push(exitItem);
                // How the headset was coping just before the pause: the only place to see it from inside.
                const flight = vrPerformance.flight;
                const lines = flight ? [t('ui.vr.performance', { ...flight, scale: Math.round(flight.scale * 100), triangles: Math.round(flight.triangles / 1000) })] : [];
                return { key: 'paused', title: t('ui.paused'), lines, columns: t('ui.vr.controls').split(' · '), items };
            }
            case PHASE.GAME_OVER: {
                const reason = state.gameOverReason ?? 'player';
                return {
                    key: `gameover:${reason}`,
                    title: t(`ui.gameOver.${reason}.title`),
                    lines: [t(`ui.gameOver.${reason}.text`)],
                    items: [
                        { label: t('ui.retry'), select: () => session.retry() },
                        { label: t('ui.quitToTitle'), select: () => session.enterTitle() },
                        exitItem,
                    ],
                    tone: 'failure',
                };
            }
            case PHASE.ENDING: {
                const score = state.finalScore;
                const lines = [t('ui.ending.text')];
                if (score) {
                    lines.push(`${t('ui.score.total')}  ${Math.round(score.total).toLocaleString()}  ·  ${score.rank}`);
                    lines.push(score.isRecord ? t('ui.score.newRecord') : t('ui.score.best', { score: Math.round(score.previousBest ?? 0).toLocaleString() }));
                }
                lines.push(t('ui.ending.thanks'));
                return {
                    key: 'ending',
                    title: t('ui.ending.title'),
                    lines,
                    items: [{ label: t('ui.ending.again'), select: () => session.enterTitle() }, exitItem],
                };
            }
            default:
                return { key: 'none', title: '', lines: [], items: [exitItem] };
        }
    }

    commonSettings(settings, t) {
        const { session } = this.game;
        const language = (step) => () => session.updateSettings({ locale: cycle(LOCALES, settings.locale, step) });
        const sound = () => session.updateSettings({ muted: !settings.muted });
        const invert = () => session.updateSettings({ invertY: !settings.invertY });
        const autoFire = () => session.updateSettings({ autoFire: !settings.autoFire });
        return [
            { label: t('ui.autoFire'), value: t(settings.autoFire ? 'ui.on' : 'ui.off'), left: autoFire, right: autoFire, select: autoFire },
            { label: t('ui.language'), value: LOCALE_LABELS[settings.locale], left: language(-1), right: language(1), select: language(1) },
            { label: t('ui.sound'), value: t(settings.muted ? 'ui.off' : 'ui.on'), left: sound, right: sound, select: sound },
            { label: t('ui.invertY'), value: t(settings.invertY ? 'ui.on' : 'ui.off'), left: invert, right: invert, select: invert },
        ];
    }

    buildRefit(state, t) {
        const { session } = this.game;
        const { points, classId, upgrades, inFlight = false } = state.refit;
        const added = this.refitAdded;
        const owned = upgradedRatings(classId, upgrades) ?? {};
        const spent = Object.values(added).reduce((sum, levels) => sum + levels, 0);
        const left = points - spent;
        const withAdded = upgradedRatings(classId, mergeUpgrades(classId, upgrades, added)) ?? {};
        const canAdd = (rating) => left > 0 && withAdded[rating] < RATING_MAX;
        const done = left === 0 || !RATING_ORDER.some(canAdd);
        const change = (rating, step) => () => {
            if (step > 0 && !canAdd(rating)) return;
            added[rating] = Math.max(0, (added[rating] ?? 0) + step);
        };
        const items = RATING_ORDER.map((rating) => {
            const extra = withAdded[rating] - (owned[rating] ?? 0);
            const level = withAdded[rating] >= RATING_MAX ? t('ui.refit.max') : String(withAdded[rating]);
            return { label: t(`ui.rating.${rating}`), value: extra > 0 ? `${level}  (+${extra})` : level, left: change(rating, -1), right: change(rating, 1), select: change(rating, 1) };
        });
        // In a match the window can be confirmed with points to spare, or closed again.
        items.push({
            label: t('ui.refit.confirm'),
            sub: t(inFlight ? 'mp.refit.note' : 'ui.refit.repairNote'),
            disabled: inFlight ? spent === 0 : !done,
            select: () => {
                session.applyRefit({ ...added });
                this.refitAdded = {};
            },
        });
        if (inFlight) {
            items.push({
                label: t('mp.refit.close'),
                select: () => {
                    session.applyRefit({});
                    this.refitAdded = {};
                },
            });
        }
        return {
            key: 'refit',
            title: t('ui.refit.title'),
            lines: [t('ui.refit.points', { points: left }), t('ui.vr.refitHint')],
            items,
        };
    }

    /** Runs a controller action against the current menu. */
    handle(action, state, t) {
        const menu = this.build(state, t);
        const { items } = menu;
        if (items.length === 0) return;
        this.index = Math.min(this.index, items.length - 1);
        const step = (direction) => {
            for (let tries = 0; tries < items.length; tries++) {
                this.index = (this.index + direction + items.length) % items.length;
                if (!items[this.index].disabled) return;
            }
        };
        const item = items[this.index];
        switch (action) {
            case 'up': step(-1); break;
            case 'down': step(1); break;
            case 'left': item.left?.(); break;
            case 'right': item.right?.(); break;
            case 'select': if (!item.disabled) item.select?.(); break;
            case 'back':
            case 'pause':
                if (this.game.session.phase === PHASE.PAUSED) this.game.session.resume();
                else if (this.launch) this.launch = null;
                // In a match: closes the star map (a vote has to be answered, or it runs out).
                else if (state.matchPanel) this.game.session.match?.presenter?.setPanel(null);
                break;
            default: break;
        }
        this.dirty = true;
    }

    /** Draws the menu if anything changed since the last call. Returns true when it did. */
    draw(panel, state, t) {
        const menu = this.build(state, t);
        if (menu.key !== this.lastKey) {
            // A different screen starts at its first row.
            this.lastKey = menu.key;
            this.index = 0;
            this.confirmingNewGame = menu.key === 'title' ? this.confirmingNewGame : false;
        }
        this.index = Math.min(this.index, Math.max(0, menu.items.length - 1));
        const signature = JSON.stringify([menu.title, menu.lines, menu.columns, menu.items.map((item) => [item.label, item.sub, item.value, item.disabled]), this.index]);
        if (!this.dirty && signature === this.lastSignature) return false;
        this.dirty = false;
        this.lastSignature = signature;
        drawMenu(panel, menu, this.index, t);
        return true;
    }
}

const ACCENT = '#59d0ff';

function drawMenu(panel, menu, selected, t) {
    const { ctx, canvas } = panel;
    const { width, height } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const failure = menu.tone === 'failure';
    roundRect(ctx, 8, 8, width - 16, height - 16, 28);
    ctx.fillStyle = 'rgba(4, 14, 26, 0.88)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = failure ? 'rgba(255, 90, 110, 0.75)' : 'rgba(89, 208, 255, 0.6)';
    ctx.stroke();

    const left = 64;
    const contentWidth = width - left * 2;
    let y = 92;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = failure ? '#ff8a9a' : '#e8f6ff';
    ctx.font = '700 46px Orbitron, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(menu.title, left, y);
    y += 26;

    ctx.font = '400 25px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(200, 225, 245, 0.85)';
    const lineHeight = 35;
    for (const text of menu.lines) {
        for (const line of wrapText(ctx, text, contentWidth)) {
            y += lineHeight;
            ctx.fillText(line, left, y);
        }
        y += 8;
    }
    if (menu.columns?.length) {
        // Two columns of short lines (the controller layout on the pause menu).
        ctx.font = '400 21px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(200, 225, 245, 0.85)';
        const half = Math.ceil(menu.columns.length / 2);
        menu.columns.forEach((text, index) => {
            const column = index < half ? 0 : 1;
            const row = column === 0 ? index : index - half;
            ctx.fillText(wrapText(ctx, text, contentWidth / 2 - 16)[0], left + column * (contentWidth / 2 + 16), y + 30 + row * 28);
        });
        y += 30 + half * 28;
    }
    y += 18;

    // Rows; on long menus they shrink so everything fits above the footer.
    const footer = height - 54;
    const rowHeight = Math.max(40, Math.min(78, (footer - y) / Math.max(1, menu.items.length)));
    menu.items.forEach((item, index) => {
        const top = y + index * rowHeight;
        const isSelected = index === selected;
        if (isSelected) {
            roundRect(ctx, left - 20, top + 4, contentWidth + 40, rowHeight - 8, 14);
            ctx.fillStyle = 'rgba(89, 208, 255, 0.18)';
            ctx.fill();
            ctx.strokeStyle = ACCENT;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        const hasSub = Boolean(item.sub);
        const labelY = top + rowHeight / 2 + (hasSub ? -2 : rowHeight > 47 ? 11 : 8);
        ctx.globalAlpha = item.disabled ? 0.4 : 1;
        ctx.textAlign = 'left';
        ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(225, 240, 255, 0.9)';
        ctx.font = `600 ${rowHeight > 60 ? 31 : rowHeight > 47 ? 27 : 23}px "PingFang SC", "Microsoft YaHei", Orbitron, sans-serif`;
        ctx.fillText(item.label, left, labelY);
        if (hasSub) {
            ctx.font = '400 19px "PingFang SC", "Microsoft YaHei", sans-serif';
            ctx.fillStyle = 'rgba(170, 205, 230, 0.8)';
            const sub = wrapText(ctx, item.sub, contentWidth * 0.62)[0];
            ctx.fillText(sub, left, labelY + 25);
        }
        if (item.value != null) {
            ctx.textAlign = 'right';
            ctx.font = `600 ${rowHeight > 60 ? 29 : rowHeight > 47 ? 25 : 22}px "PingFang SC", "Microsoft YaHei", Orbitron, sans-serif`;
            ctx.fillStyle = isSelected ? ACCENT : 'rgba(150, 215, 255, 0.85)';
            const valueY = top + rowHeight / 2 + (rowHeight > 47 ? 11 : 8);
            ctx.fillText(isSelected && item.left ? `◀  ${item.value}  ▶` : item.value, left + contentWidth, valueY);
        }
        ctx.globalAlpha = 1;
    });

    ctx.textAlign = 'center';
    ctx.font = '400 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(160, 200, 230, 0.7)';
    ctx.fillText(t('ui.vr.menuHint'), width / 2, height - 30);
    panel.commit();
}
