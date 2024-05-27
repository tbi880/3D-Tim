let nextScene = sessionStorage.getItem('nextScene') || "sceneOne";
let nextSceneStartPoint = JSON.parse(sessionStorage.getItem('nextSceneStartPoint')) || 0;
let engineeringHasBeenAccessed = JSON.parse(localStorage.getItem('engineeringHasBeenAccessed')) || false;
let shipHangerHasBeenAccessed = JSON.parse(localStorage.getItem('shipHangerHasBeenAccessed')) || false;
let rootAccess = JSON.parse(localStorage.getItem('rootAccess')) || false;

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
let waitingTime = 0;
let lock = false;

export function jumpToTheNextScene(nextScene) {
    // 检查并等待锁可用
    if (lock) {
        setTimeout(() => jumpToTheNextScene(nextScene), 100);
        return;
    }

    // 获取锁
    lock = true;

    // sleep waitingTime 秒
    setTimeout(() => {
        // 修改等待时间
        waitingTime++;

        // 释放锁
        lock = false;

        console.log(waitingTime);

        // 重新加载当前页面到映射到下一个场景的新 URI
        window.location.href = scene_uri_map[nextScene];
    }, waitingTime * 1000);
}

export function getRootAccess() {
    // console.log(rootAccess);
    return JSON.parse(localStorage.getItem('rootAccess'));
}

function Status() {

    return (
        <></>
    )
}



export default Status;