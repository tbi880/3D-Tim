import { useEffect, useState, useCallback, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import TextTitle from './TextTitle';
import TextContent from './TextContent';
import Arrow from './Arrow';
import { bucketURL } from '../Settings';

const animationnames = ["Take 001"]


function InfoScreenDisplay({ title, content, sequence, stopPoints = [], loadPoints = [], unloadPoints = [], onSequencePass }) {
    const screenModel = useGLTF(bucketURL + "sci-fi-screen-transformed.glb", true, true);
    const [opacity, setOpacity] = useState(1);
    const theatreKey = ("InfoScreenDisplay: " + title).trim();
    const [pages, setPages] = useState([]); // 二维数组，保存页和行
    const animation1 = useAnimations(screenModel.animations, screenModel.scene)
    const action1 = animation1.actions[animationnames[0]]

    function checkForHowManyPagesAreNeeded() {
        console.log('you need pages of ', pages.length);
    }

    useEffect(() => {
        if (stopPoints.length === 0 || loadPoints.length === 0 || unloadPoints.length === 0) {
            checkForHowManyPagesAreNeeded();
            // throw new Error('stopPoints, loadPoints, unloadPoints are not provided');

        }
    }, [pages.length]);


    useFrame(() => {
        action1.play();
    })

    const { camera } = useThree();
    const [positionInFrontOfCamera, setPositionInFrontOfCamera] = useState([0, 0, 0]);
    const [rotationInFrontOfCamera, setRotationInFrontOfCamera] = useState([0, 0, 0]);
    const [positionInFrontOfCameraForTextTitle, setPositionInFrontOfCameraForTextTitle] = useState([0, 0, 0]);
    const [rotationInFrontOfCameraForTextTitle, setRotationInFrontOfCameraForTextTitle] = useState([0, 0, 0]);

    useEffect(() => {
        screenModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [screenModel.scene, opacity]);

    useEffect(() => {
        const offset = new Vector3(0, 0, 2);
        camera.updateMatrixWorld();
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        const position = camera.position.clone().add(cameraDirection.multiply(offset));
        const rotation = camera.rotation.clone();

        setPositionInFrontOfCamera([position.x, position.y, position.z]);
        setRotationInFrontOfCamera([rotation.x, rotation.y, rotation.z + 1.57]);
        setPositionInFrontOfCameraForTextTitle([position.x, position.y, position.z]);
        setRotationInFrontOfCameraForTextTitle([rotation.x, rotation.y, rotation.z]);
    }, [camera]);



    // 将文本分割为页和行的函数
    const splitTextIntoPagesAndLines = (text, maxCharsPerLine = 15, maxLinesPerPage = 14) => {
        const words = text.split(' ');
        let currentPage = [];
        let currentLine = words[0];
        let currentPageLines = [];

        words.slice(1).forEach(word => {
            if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
                currentLine += ' ' + word;
            } else {
                currentPageLines.push(currentLine);
                currentLine = word;

                if (currentPageLines.length === maxLinesPerPage) {
                    pages.push(currentPageLines);
                    currentPageLines = [];
                }
            }
        });

        // Add any leftover line and pages
        if (currentLine) currentPageLines.push(currentLine);
        if (currentPageLines.length) pages.push(currentPageLines);

        setPages(pages);
    };

    useEffect(() => {
        splitTextIntoPagesAndLines(content);
    }, [content]); // 当content变化时重新计算


    // 使用一个对象来管理多个组件的初始显示状态
    const [showTextContent, setShowTextContent] = useState({
        // 例如: otherComponent: true,
    });

    //使用一个对象来管理多个组件的装载和卸载时间点，textComponentName:[装载点时间点，卸载时间点]
    const [textComponentStartAndEndPoints, setTextComponentStartAndEndPoints] = useState({
        // 例如: textComponentName: [0, 1],
    });

    function addComponentToShowTextContent(componentName, pageIndex, initialState) {
        // 使用展开运算符复制现有状态，并添加新的组件状态
        setShowTextContent(prevState => ({
            ...prevState,
            [componentName]: initialState
        }));

        // 使用展开运算符复制现有状态，并添加新的组件时间点
        setTextComponentStartAndEndPoints(prevState => ({
            ...prevState,
            [componentName]: [loadPoints[pageIndex], unloadPoints[pageIndex]],
        }));
    }

    function removeComponentToShowTextContent(componentName) {
        // 使用展开运算符复制现有状态，并删除指定组件状态
        setShowTextContent(prevState => {
            const { [componentName]: removedComponent, ...rest } = prevState;
            return rest;
        });

        // 使用展开运算符复制现有状态，并删除指定组件时间点
        setTextComponentStartAndEndPoints(prevState => {
            const { [componentName]: removedComponent, ...rest } = prevState;
            return rest;
        });
    }



    //当内容更新了pages也会发生改变，pages更新了则有可能多出几个pages或者少几个，则组件数量也会相应的变化
    useEffect(() => {
        //先判断当前pages的数量和showTextContent的数量是否一致，如果不一致则进行相应的操作
        if (Object.keys(showTextContent).length !== pages.length) {
            //如果pages的数量比showTextContent的数量多，则添加新的组件
            if (Object.keys(showTextContent).length < pages.length) {
                for (let i = Object.keys(showTextContent).length; i < pages.length; i++) {
                    addComponentToShowTextContent(`textContent${i}`, i, false);
                }
            }
            //如果pages的数量比showTextContent的数量少，则删除多余的组件
            if (Object.keys(showTextContent).length > pages.length) {
                for (let i = pages.length; i < Object.keys(showTextContent).length; i++) {
                    removeComponentToShowTextContent(`textContent${i}`);
                }
            }
        }
    }, [pages, stopPoints]);

    // 创建一个通用的切换函数
    const toggleTextContentDisplay = useCallback((TextContentName) => {
        setShowTextContent((prev) => ({
            ...prev,
            [TextContentName]: !prev[TextContentName],
        }));

    }, []);

    const loadPageIndex = useRef(0);
    const unloadPageIndex = useRef(0);

    useFrame(() => {
        if (sequence) {
            const currentPosition = sequence.position;


            // 当sequence.position超过每个textComponentStartAndEndPoints的装载时间点时,并且那个组件还没有被装载的时候触发
            if (textComponentStartAndEndPoints[`textContent${loadPageIndex.current}`] && !showTextContent[`textContent${loadPageIndex.current}`] && currentPosition >= textComponentStartAndEndPoints[`textContent${loadPageIndex.current}`][0]) {
                toggleTextContentDisplay(`textContent${loadPageIndex.current}`);
                loadPageIndex.current++;

            }

            // 当sequence.position超过每个textComponentStartAndEndPoints的卸载时间点时,并且那个组件还没有被卸载的时候触发
            if (textComponentStartAndEndPoints[`textContent${unloadPageIndex.current}`] && currentPosition >= textComponentStartAndEndPoints[`textContent${unloadPageIndex.current}`][1] && showTextContent[`textContent${unloadPageIndex.current}`]) {
                toggleTextContentDisplay(`textContent${unloadPageIndex.current}`);
                unloadPageIndex.current++;
            }
            // 当sequence.position超过结束点时触发

            if (currentPosition >= unloadPoints[unloadPoints.length - 1]) {
                onSequencePass(); // 调用从父组件传递的函数来卸载自己
            }


        }
    });

    return (
        <>
            <e.mesh theatreKey={theatreKey} scale={10} position={positionInFrontOfCamera} rotation={rotationInFrontOfCamera} additionalProps={{
                opacity: types.number(opacity, {
                    range: [0, 1],
                }),
            }} objRef={(theatreObject) => {
                theatreObject.onValuesChange((newValues) => {
                    setOpacity(newValues.opacity);
                });
            }}>
                <primitive object={screenModel.scene} />
            </e.mesh>

            <TextTitle text={title} color="white" size={0.1} position={positionInFrontOfCameraForTextTitle} rotation={rotationInFrontOfCameraForTextTitle} />
            <Arrow screenTitle={title} isNext={true} position={positionInFrontOfCamera} rotation={rotationInFrontOfCamera} sequence={sequence} stopPoints={stopPoints} />

            {pages.map((page, pageIndex) => (
                (showTextContent[`textContent${pageIndex}`] && <TextContent key={`${pageIndex}`} title={title} order={pageIndex} lines={pages[pageIndex]} color="#000000" size={0.07} position={[positionInFrontOfCameraForTextTitle[0], positionInFrontOfCameraForTextTitle[1], positionInFrontOfCameraForTextTitle[2]]} rotation={rotationInFrontOfCameraForTextTitle} />)

            ))}
        </>
    );
}


export default InfoScreenDisplay;
