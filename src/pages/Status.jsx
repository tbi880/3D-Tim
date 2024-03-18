let nextScene = sessionStorage.getItem('nextScene') || "sceneOne";
let nextSceneStartPoint = JSON.parse(sessionStorage.getItem('nextSceneStartPoint')) || 0;
let engineeringHasBeenAccessed = JSON.parse(sessionStorage.getItem('engineeringHasBeenAccessed')) || false;
let shipHangerHasBeenAccessed = JSON.parse(sessionStorage.getItem('shipHangerHasBeenAccessed')) || false;
let rootAccess = JSON.parse(sessionStorage.getItem('rootAccess')) || false;

export function getNextScene() {
    return sessionStorage.getItem('nextScene') || "sceneOne";
}

export function getNextSceneStartPoint() {
    return JSON.parse(sessionStorage.getItem('nextSceneStartPoint'));
}

export function setNextScene(scene) {
    sessionStorage.setItem('nextScene', scene);
}

export function setNextSceneStartPoint(point) {
    sessionStorage.setItem('nextSceneStartPoint', JSON.stringify(point));
}

export function engineeringAccess() {
    sessionStorage.setItem('engineeringHasBeenAccessed', 'true');
    checkStauts();
}

export function shipHangerAccess() {
    sessionStorage.setItem('shipHangerHasBeenAccessed', 'true');
    checkStauts();
}

export function getEngineeringHasBeenAccessed() {
    return JSON.parse(sessionStorage.getItem('engineeringHasBeenAccessed'));
}

export function getShipHangerHasBeenAccessed() {
    return JSON.parse(sessionStorage.getItem('shipHangerHasBeenAccessed'));
}


export function checkStauts() {
    if (getEngineeringHasBeenAccessed() && getShipHangerHasBeenAccessed()) {
        sessionStorage.setItem('rootAccess', 'true');

    }
}



export function getRootAccess() {
    // console.log(rootAccess);
    return JSON.parse(sessionStorage.getItem('rootAccess'));
}

function Status() {



    return (
        <></>
    )
}



export default Status;