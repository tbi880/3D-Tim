let nextScene = sessionStorage.getItem('nextScene') || "sceneOne";
let nextSceneStartPoint = JSON.parse(sessionStorage.getItem('nextSceneStartPoint')) || 0;
let engineeringHasBeenAccessed = JSON.parse(sessionStorage.getItem('engineeringHasBeenAccessed')) || false;
let shipHangerHasBeenAccessed = JSON.parse(sessionStorage.getItem('shipHangerHasBeenAccessed')) || false;
let rootAccess = JSON.parse(sessionStorage.getItem('rootAccess')) || false;

export const scene_uri_map = {
    "sceneOne": "/",
    "sceneTwo": "/bridge",
    "sceneThree": "/ship_hanger",
}

// Initial scene menu lock map
const scene_menu_lock_map = {
    "sceneOne": false,
    "sceneTwo": true,
    "sceneThree": true,
};


function saveMapToSessionStorage(map) {
    sessionStorage.setItem('scene_menu_lock_map', JSON.stringify(map));
}


export function getMenuLockMapFromSessionStorage() {
    const map = sessionStorage.getItem('scene_menu_lock_map');
    return map ? JSON.parse(map) : null;
}


if (!getMenuLockMapFromSessionStorage()) {
    saveMapToSessionStorage(scene_menu_lock_map);
}


export function unlockScene(scene) {
    const map = getMenuLockMapFromSessionStorage();
    if (map) {
        map[scene] = false;
        saveMapToSessionStorage(map);
    } else {
        console.error("Failed to retrieve the map from sessionStorage.");
    }
}

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

export function jumpToTheNextScene(nextScene) {
    //reload current page to the new uri which maps to the next scene
    window.location.href = scene_uri_map[nextScene];
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