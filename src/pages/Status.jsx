import { useXR } from "@react-three/xr";

let nextScene = sessionStorage.getItem('nextScene') || "sceneOne";
let nextSceneStartPoint = JSON.parse(sessionStorage.getItem('nextSceneStartPoint')) || 0;
let engineeringHasBeenAccessed = JSON.parse(localStorage.getItem('engineeringHasBeenAccessed')) || false;
let shipHangerHasBeenAccessed = JSON.parse(localStorage.getItem('shipHangerHasBeenAccessed')) || false;
let rootAccess = JSON.parse(localStorage.getItem('rootAccess')) || false;
let userDpr = JSON.parse(localStorage.getItem('userDpr')) ?? window.innerHeight > window.innerWidth ? 1 : 1.5;
let userAntialias = JSON.parse(localStorage.getItem('userAntialias')) ?? window.innerHeight > window.innerWidth ? false : true;
let userDisableUnnecessaryComponentAnimation = JSON.parse(localStorage.getItem('userDisableUnnecessaryComponentAnimation')) ?? window.innerHeight > window.innerWidth ? true : false;


export const scene_uri_map = {
    "sceneOne": "/",
    "sceneTwo": "/bridge",
    "sceneThree": "/ship_hanger",
    "sceneFour": "/ship_engineering",
    "sceneFive": "/ship_captains_chamber",
    "sceneSix": "/project_dawn",
}

// Initial scene menu lock map
const scene_menu_lock_map = {
    "sceneOne": false,
    "sceneTwo": true,
    "sceneThree": true,
    "sceneFour": true,
    "sceneFive": true,
    "sceneSix": true,
};


function saveMapToLocalStorage(map) {
    localStorage.setItem('scene_menu_lock_map', JSON.stringify(map));
}


export function getMenuLockMapFromLocalStorage() {
    const map = localStorage.getItem('scene_menu_lock_map');
    return map ? JSON.parse(map) : null;
}


if (!getMenuLockMapFromLocalStorage()) {
    saveMapToLocalStorage(scene_menu_lock_map);
}


export function unlockScene(scene) {
    const map = getMenuLockMapFromLocalStorage();
    if (map) {
        map[scene] = false;
        saveMapToLocalStorage(map);
    } else {
        console.error("Failed to retrieve the map from localStorage.");
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
    localStorage.setItem('engineeringHasBeenAccessed', 'true');
    checkStauts();
}

export function shipHangerAccess() {
    localStorage.setItem('shipHangerHasBeenAccessed', 'true');
    checkStauts();
}

export function getEngineeringHasBeenAccessed() {
    return JSON.parse(localStorage.getItem('engineeringHasBeenAccessed'));
}

export function getShipHangerHasBeenAccessed() {
    return JSON.parse(localStorage.getItem('shipHangerHasBeenAccessed'));
}


export function checkStauts() {
    if (getEngineeringHasBeenAccessed() && getShipHangerHasBeenAccessed()) {
        localStorage.setItem('rootAccess', 'true');

    }
}

// //废弃
// export function jumpToTheNextScene(nextScene) {
//     // 重新加载当前页面到映射到下一个场景的新 URI
//     window.location.href = scene_uri_map[nextScene];
// }

export function getNextSceneURI(nextScene) {
    return scene_uri_map[nextScene];
}

export function getRootAccess() {
    // console.log(rootAccess);
    return JSON.parse(localStorage.getItem('rootAccess'));
}


export function setUserDpr(dpr) {
    localStorage.setItem('userDpr', dpr);
}

export function getUserDpr(isPortraitPhoneScreen) {
    return JSON.parse(localStorage.getItem('userDpr')) ?? (isPortraitPhoneScreen ? 1 : 1.5);
}

export function setUserAntialias(antialias) {
    localStorage.setItem('userAntialias', antialias);
}

export function getUserAntialias(isPortraitPhoneScreen) {
    return JSON.parse(localStorage.getItem('userAntialias')) ?? isPortraitPhoneScreen ? false : true;
}

export function setUserDisableUnnecessaryComponentAnimation(disable) {
    localStorage.setItem('userDisableUnnecessaryComponentAnimation', disable);
}

export function getUserDisableUnnecessaryComponentAnimation(isPortraitPhoneScreen) {
    return JSON.parse(localStorage.getItem('userDisableUnnecessaryComponentAnimation')) ?? isPortraitPhoneScreen ? true : false;
}

function Status() {

    return (
        <></>
    )
}



export default Status;