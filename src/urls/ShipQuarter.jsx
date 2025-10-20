
import Status, { getNextSceneStartPoint, getTourMapFromLocalStorage, hasTourGuided } from '../pages/Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { SheetProvider } from '@theatre/r3f';
import { useContext, useEffect, useRef, useState } from 'react';
import { headerSubTitleContext } from '../sharedContexts/HeaderSubTitleProvider';
import { graphicSettingContext } from '../sharedContexts/GraphicSettingProvider';
import { getProject } from '@theatre/core';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import Header from '../Tools/Header';
import Quarter from '../pages/Quarter';
import quarterState from '../Quarter.json';



function ShipQuarter({ isPortraitPhoneScreen }) {
    const quarterProject = getProject('Quarter', { state: quarterState });
    const quarterSheet = quarterProject.sheet('Quarter');
    const { showHeaderSubTitle, setShowHeaderSubTitle } = useContext(headerSubTitleContext);
    const { dpr, setDpr, antialias, setAntialias, disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation } = useContext(graphicSettingContext);

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Back to your quarter on the ship.</title>
                <meta name="description" content="It's time to back to your quarter on the ship. Log in and prove your identity." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Back to your quarter on the ship." />
                <meta property="og:description" content="It's time to back to your quarter on the ship. Log in and prove your identity." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/ship_quarter" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_quarter" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            {showHeaderSubTitle && <Header onAnimationEnd={() => { setShowHeaderSubTitle(false) }} defaultBaseDuration={7} defaultNotice={{ noticeContent: "Welcome to your quarter, please log in to continue.", noticeLink: null }} />}

            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <CanvasProvider>
                    <SheetProvider sheet={quarterSheet}>
                        <Quarter quarterSheet={quarterSheet} quarterProject={quarterProject} isPortraitPhoneScreen={isPortraitPhoneScreen} />
                    </SheetProvider>

                </CanvasProvider>
            </div>


            <Status />
        </>
    )

}

export default ShipQuarter;

