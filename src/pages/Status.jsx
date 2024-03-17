let nextScene = "sceneTwo";
let nextSceneStartPoint = 0;
export function getNextScene() {
    return nextScene;
}

export function setNextScene(scene) {
    nextScene = scene;
}

export function getNextSceneStartPoint() {
    return nextSceneStartPoint;
}

export function setNextSceneStartPoint(point) {
    nextSceneStartPoint = point;
}

export let engineeringHasBeenAccessed = false;
export let shipHangerHasBeenAccessed = false;
let rootAccess = false;

export function checkStauts() {
    if (engineeringHasBeenAccessed && shipHangerHasBeenAccessed) {
        rootAccess = true;
    }
}

export function engineeringAccess() {
    engineeringHasBeenAccessed = true;
    checkStauts();
}

export function shipHangerAccess() {
    shipHangerHasBeenAccessed = true;
    checkStauts();
}

export function getRootAccess() {
    // console.log(rootAccess);
    return rootAccess;
}

function Status() {



    return (
        <></>
    )
}



export default Status;