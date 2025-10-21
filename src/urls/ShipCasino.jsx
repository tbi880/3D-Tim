
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
// import { Controllers, Hands, VRButton, XR } from '@react-three/xr';
import { SheetProvider } from '@theatre/r3f';
import { useContext, useEffect, useRef, useState } from 'react';
import { headerSubTitleContext } from '../sharedContexts/HeaderSubTitleProvider';
import { getProject } from '@theatre/core';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import Header from '../Tools/Header';
import Casino from '../pages/Casino';
import casinoState from '../Casino.json';
import { casinoFormContext } from '../sharedContexts/CasinoFormProvider';
import CasinoRoomForm from '../Tools/CasinoRoomForm';


function ShipCasino({ isPortraitPhoneScreen }) {
    const casinoProject = getProject('Casino', { state: casinoState });
    const casinoSheet = casinoProject.sheet('Casino');
    const { showHeaderSubTitle, setShowHeaderSubTitle } = useContext(headerSubTitleContext);
    const { showCasinoForm, setShowCasinoForm } = useContext(casinoFormContext);

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - To the ship's casino.</title>
                <meta name="description" content="After the successfully upgraded the ship, the crew is now ready to explore the ship's casino which is filled with excitement and uncertainty." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - To the ship's casino." />
                <meta property="og:description" content="After the successfully upgraded the ship, the crew is now ready to explore the ship's casino which is filled with excitement and uncertainty." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/ship_casino" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_casino" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            {showHeaderSubTitle && <Header onAnimationEnd={() => { setShowHeaderSubTitle(false) }} defaultBaseDuration={7} defaultNotice={{ noticeContent: "Welcome to Tim's casino, No real money involved! You can enjoy the games without any risk. However you can make custom agreement with your real life friends using the bets and save it here, you can comeback and review them anytime.", noticeLink: null }} />}
            {showCasinoForm && <CasinoRoomForm />}
            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <CanvasProvider>
                    <SheetProvider sheet={casinoSheet}>
                        <Casino casinoSheet={casinoSheet} casinoProject={casinoProject} isPortraitPhoneScreen={isPortraitPhoneScreen} />
                    </SheetProvider>
                </CanvasProvider>

            </div>


        </>
    )

}

export default ShipCasino;

