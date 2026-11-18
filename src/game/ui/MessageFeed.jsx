import { useState } from 'react';
import { MESSAGE_FEED, shownLines } from '../state/MessageFeed.js';
import { useGameStore, useT } from '../state/gameStore.js';
import { feedSegments, feedText } from './feedText.js';

/**
 * The message feed on the page: the last few lines of a match's news - who shot whom down -
 * one under the other at the side of the screen, each for a few seconds (state/MessageFeed.js
 * keeps them and takes them down; with none left this draws nothing). GameHud puts it in the
 * top right dock, under the target and the toast, so it stacks with them.
 *
 * A line is painted from its pieces (ui/feedText.js): a side's short name as a tag, names in
 * their side's colour, the weapon between them. A line about the player themself stands out:
 * amber when the kill is theirs, red when they are the one shot down. `compact` (a phone):
 * fewer lines, no tags, an arrow for the weapon.
 */

/**
 * One line. It comes in, holds and fades out over exactly the time the feed keeps it (the
 * `eod-feed-line` animation, hud.css). A line that is first drawn late - it was pushed off a
 * small screen by weightier ones and has come back - starts as far into that as it is old.
 */
function FeedLine({ line, session, compact }) {
    const t = useT();
    const [age] = useState(() => Math.max(0, session.feed.time - line.at));
    return (
        <div
            className={`eod-feed-line ${line.you ? `eod-feed-line--${line.you}` : ''}`}
            style={{ animationDuration: `${line.until - line.at}s`, animationDelay: `${-age}s` }}
            title={feedText(t, line)}
        >
            {feedSegments(t, line, { compact }).map((piece, index) => (
                // (The pieces of a line never change places: their order is their identity.)
                <span key={index} className={`eod-feed-${piece.role} eod-feed-tone--${piece.tone}`}>{piece.text}</span>
            ))}
        </div>
    );
}

export default function MessageFeed({ session, compact = false }) {
    const feed = useGameStore((state) => state.feed);
    const t = useT();
    const lines = shownLines(feed, compact ? MESSAGE_FEED.rows.touch : MESSAGE_FEED.rows.desktop);
    if (lines.length === 0) return null;
    return (
        <div className={`eod-feed ${compact ? 'eod-feed--compact' : ''}`} role="log" aria-label={t('mp.feed.title')}>
            {lines.map((line) => <FeedLine key={line.id} line={line} session={session} compact={compact} />)}
        </div>
    );
}
