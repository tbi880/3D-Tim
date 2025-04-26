import { SendDistressSignalProvider } from "./SendDistressSignalProvider";
import { GlobalNotificationProvider } from "./GlobalNotificationProvider";
import { AuthorizationCheckProvider } from "./AuthorizationCheckProvider";
import { SearchForEmergencyPlansProvider } from "./SearchForEmergencyPlansProvider";
import { HeaderSubTitleProvider } from "./HeaderSubTitleProvider";
import { GraphicSettingProvider } from "./GraphicSettingProvider";
import { TaskBoardContentProvider } from "./TaskBoardContentProvider";
import { SheetSequencePlayControlProvider } from "./SheetSequencePlayControlProvider";
import { TheatreStudioProvider } from "./TheatreStudioProvider";

function GlobalProviders({ children }) {
    return (
        <GlobalNotificationProvider>
            <SendDistressSignalProvider>
                <AuthorizationCheckProvider>
                    <SearchForEmergencyPlansProvider>
                        <HeaderSubTitleProvider>
                            <GraphicSettingProvider>
                                <TaskBoardContentProvider>
                                    <SheetSequencePlayControlProvider>
                                        <TheatreStudioProvider>
                                            {children}
                                        </TheatreStudioProvider>
                                    </SheetSequencePlayControlProvider>
                                </TaskBoardContentProvider>
                            </GraphicSettingProvider>
                        </HeaderSubTitleProvider>
                    </SearchForEmergencyPlansProvider>
                </AuthorizationCheckProvider>
            </SendDistressSignalProvider>
        </GlobalNotificationProvider>
    );
}

export default GlobalProviders;