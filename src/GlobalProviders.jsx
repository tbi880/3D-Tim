import { SendDistressSignalProvider } from "./sharedContexts/SendDistressSignalProvider";

function GlobalProviders({ children }) {
    return (
        <SendDistressSignalProvider>
            {children}
        </SendDistressSignalProvider>

    );
}

export default GlobalProviders;