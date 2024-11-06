import { SendDistressSignalProvider } from "./SendDistressSignalProvider";
import { GlobalNotificationProvider } from "./GlobalNotificationProvider";
import { AuthorizationCheckProvider } from "./AuthorizationCheckProvider";
import { SearchForEmergencyPlansProvider } from "./SearchForEmergencyPlansProvider";
import { HeaderSubTitleProvider } from "./HeaderSubTitleProvider";

function GlobalProviders({ children }) {
    return (
        <GlobalNotificationProvider>
            <SendDistressSignalProvider>
                <AuthorizationCheckProvider>
                    <SearchForEmergencyPlansProvider>
                        <HeaderSubTitleProvider>
                            {children}
                        </HeaderSubTitleProvider>
                    </SearchForEmergencyPlansProvider>
                </AuthorizationCheckProvider>
            </SendDistressSignalProvider>
        </GlobalNotificationProvider>
    );
}

export default GlobalProviders;