import scene1State from '../scene1.json';
import scene2State from '../scene2.json';
import scene3State from '../scene3.json';
import sceneJessieState from '../sceneJessie.json';
import scene5State from '../scene5.json';
import { getProject } from '@theatre/core';


export const scene1Project = getProject('Scene1 Sheet', { state: scene1State });
export const scene1Sheet = scene1Project.sheet('Scene1 Sheet');
export const scene2Project = getProject('Scene2 Sheet', { state: scene2State });
export const scene2Sheet = scene2Project.sheet('Scene2 Sheet');
export const scene3Project = getProject('Scene3 Sheet', { state: scene3State });
export const scene3Sheet = scene3Project.sheet('Scene3 Sheet');
export const sceneJessieProject = getProject('SceneJessie', { state: sceneJessieState });
export const sceneJessieSheet = sceneJessieProject.sheet('SceneJessie');
export const scene5Project = getProject('Scene5', { state: scene5State });
export const scene5Sheet = scene5Project.sheet('Scene5');


function SceneManager() {


    return (<>

    </>
    )
}

export default SceneManager;