import { SendDistressSignalProvider } from "./sharedContexts/SendDistressSignalProvider";
import { GlobalNotificationProvider } from "./sharedContexts/GlobalNotificationProvider";

function GlobalProviders({ children }) {
    return (
        <GlobalNotificationProvider>
            <SendDistressSignalProvider>
                {children}
            </SendDistressSignalProvider>
        </GlobalNotificationProvider>
    );
}

export default GlobalProviders;