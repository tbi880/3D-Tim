import { Component } from 'react';
import { useT } from '../state/gameStore.js';

/** In place of a screen that could not be drawn: what went wrong, and the ways out of it. */
function ScreenError({ error, onRetry, onBack }) {
    const t = useT();
    return (
        <div className="eod-menu eod-screen-error" role="alert">
            <h2 className="eod-hangar-title">{t('ui.screenError.title')}</h2>
            <p className="eod-screen-text">{t('ui.screenError.text')}</p>
            <code className="eod-screen-error-detail">{String(error?.message ?? error)}</code>
            <button type="button" className="eod-button eod-button--primary" onClick={onRetry}>{t('ui.screenError.retry')}</button>
            {onBack && <button type="button" className="eod-button" onClick={onBack}>{t('ui.back')}</button>}
        </div>
    );
}

/**
 * Keeps an error in one menu screen inside that screen. Without it React takes the whole page
 * down - the game, the HUD and every menu - and the player is left with a white screen.
 *
 * The message is shown on the screen itself: the production build strips every console call
 * (vite.config.js, drop_console), so React's own report of the error never reaches the console.
 * `reportError` is not a console call, so the full error with its stack still gets there.
 *
 * @param {object} props
 * @param {() => void} [props.onBack] leaves the broken screen (no Back button without it)
 * @param {import('react').ReactNode} props.children
 */
export default class ScreenErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error) {
        if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
    }

    retry = () => this.setState({ error: null });

    back = () => {
        this.props.onBack();
        this.setState({ error: null });
    };

    render() {
        const { error } = this.state;
        if (error === null) return this.props.children;
        return <ScreenError error={error} onRetry={this.retry} onBack={this.props.onBack ? this.back : null} />;
    }
}
