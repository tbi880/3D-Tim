import { Helmet } from "react-helmet";
import Status from "./Status";
import '../Tools/css/scene4.css';
import { SceneFour } from "./SceneFour";
import { bucketURL } from '../Settings';
import { useContext, useEffect, useRef } from "react";
import { GlobalNotificationContext } from "../sharedContexts/GlobalNotificationProvider";


function ShipEngineering(isPortraitPhoneScreen) {
    const welcomeMessageSent = useRef(false);
    const { messageApi } = useContext(GlobalNotificationContext);
    useEffect(() => {
        if (welcomeMessageSent.current) return;
        welcomeMessageSent.current = true;
        messageApi(
            'success',
            "Welcome to the Engineering dept - Tim's workshop gallery!",
            3,
        )
    }, [messageApi])

    const pexel = (project_name) => bucketURL + "scene4/" + project_name;
    const images = [
        // Front
        { position: [0, 0, 1.5], rotation: [0, 0, 0], url: pexel("vitcode.com.jpg"), project_name: "Vertical Information Technology Ltd.- \n - www.vitcode.com - www.vit.ltd" },
        // // Back
        { position: [-0.8, 0, -0.6], rotation: [0, 0, 0], url: pexel("wendybradford.co.nz.jpg"), project_name: "WENDY BRADFORD INTERIOR DESIGN - \n - www.wendybradford.co.nz" },
        { position: [0.8, 0, -0.6], rotation: [0, 0, 0], url: pexel("bradfordrealestatesolutions.com.jpg"), project_name: "Bradford Real Estate Solutions - \n - www.bradfordrealestatesolutions.com" },
        // Left
        { position: [-1.75, 0, 0.25], rotation: [0, Math.PI / 2.5, 0], url: pexel("nzacg.co.nz.jpg"), project_name: "Auckland Construction Group- \n -www.nzacg.co.nz" },
        // { position: [-2.15, 0, 1.5], rotation: [0, Math.PI / 2.5, 0], url: pexel(5) },
        // { position: [-2, 0, 2.75], rotation: [0, Math.PI / 2.5, 0], url: pexel(6) },
        // Right
        { position: [1.75, 0, 0.25], rotation: [0, -Math.PI / 2.5, 0], url: pexel("njyns.com.jpg"), project_name: "Nanjing Unison Company - \n - www.njyns.com" },
        // { position: [2.15, 0, 1.5], rotation: [0, -Math.PI / 2.5, 0], url: pexel(8) },
        // { position: [2, 0, 2.75], rotation: [0, -Math.PI / 2.5, 0], url: pexel(9) }
    ]

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Scene4: Arrive at the ship's engineering</title>
                <meta name="description" content="Let's go to the ship's engineering and access Tim Bi's working experience gallery." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Scene4: Arrive at the ship's engineering" />
                <meta property="og:description" content="Let's go to the ship's engineering and access Tim Bi's working experience gallery." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/ship_engineering" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_engineering" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            <SceneFour images={images} isPortraitPhoneScreen={isPortraitPhoneScreen} />
            <Status />
        </>
    )

}

export default ShipEngineering;