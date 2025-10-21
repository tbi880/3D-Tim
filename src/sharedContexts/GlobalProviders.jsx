import { SendDistressSignalProvider } from "./SendDistressSignalProvider";
import { GlobalNotificationProvider } from "./GlobalNotificationProvider";
import { AuthorizationCheckProvider } from "./AuthorizationCheckProvider";
import { SearchForEmergencyPlansProvider } from "./SearchForEmergencyPlansProvider";
import { HeaderSubTitleProvider } from "./HeaderSubTitleProvider";
import { GraphicSettingProvider } from "./GraphicSettingProvider";
import { TaskBoardContentProvider } from "./TaskBoardContentProvider";
import { SheetSequencePlayControlProvider } from "./SheetSequencePlayControlProvider";
import { TheatreStudioProvider } from "./TheatreStudioProvider";
import { CasinoFormProvider } from "./CasinoFormProvider";

function GlobalProviders({ children }) {
    return (
        <GlobalNotificationProvider>
            <SendDistressSignalProvider>
                <AuthorizationCheckProvider>
                    <SearchForEmergencyPlansProvider>
                        <HeaderSubTitleProvider>
                            <GraphicSettingProvider>
                                <TaskBoardContentProvider>
                                    <CasinoFormProvider>
                                        <SheetSequencePlayControlProvider>
                                            <TheatreStudioProvider>
                                                {children}
                                            </TheatreStudioProvider>
                                        </SheetSequencePlayControlProvider>
                                    </CasinoFormProvider>
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