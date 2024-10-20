import { engineeringAccess, getNextScene, jumpToTheNextScene, setNextScene, setNextSceneStartPoint } from './Status'
import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCursor, MeshReflectorMaterial, Image, Text, Environment, Html } from '@react-three/drei'
import { useRoute, useLocation } from 'wouter'
import { easing } from 'maath'
import getUuid from 'uuid-by-string'
import { Suspense } from 'react'
import WaitingForMoreModels from './WaitingForMoreModels';
import { bucketURL } from '../Settings'
import { useCallback } from 'react'
import AnyModel from '../modelComponents/AnyModel'

const GOLDENRATIO = 1.61803398875

export const SceneFour = ({ images }) => { return <Canvas dpr={[1, 1.5]}><SceneFourInsideOfCanvas images={images} /></Canvas> }

export const SceneFourInsideOfCanvas = ({ images }) => {
    const [visitedIds, setVisitedIds] = useState(new Set());
    const [cameraReached, setCameraReached] = useState(false);
    const startPosition = [0, 2, 15];
    const targetPosition = [0, 0, 5.5];
    const [showComponents, setShowComponents] = useState({
        loading: false
    });
    const [loadingOpacity, setLoadingOpacity] = useState(0);

    const [countDown, setCountDown] = useState(3);

    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],

        }));
    }, []);


    useEffect(() => {
        let opacityInterval; // 提升到 useEffect 作用域顶部
        let intervalId; // 同样提升 intervalId

        if (visitedIds.size === images.length && cameraReached) {
            if (!showComponents.loading) {
                toggleComponentDisplay("loading");
                let opacity = 0;
                opacityInterval = setInterval(() => {
                    opacity += 0.01;
                    setLoadingOpacity(opacity);
                    if (opacity >= 1) {
                        clearInterval(opacityInterval);
                    }
                }, 20);
            }

            intervalId = setInterval(() => {
                setCountDown((prev) => {
                    if (prev > 0) {
                        return prev - 1;
                    } else {
                        clearInterval(intervalId);
                        jumpToTheNextScene(getNextScene());
                        return 0;
                    }
                });
            }, 1000);

        }
    }, [visitedIds, images.length, cameraReached]);

    useEffect(() => {
        setNextScene("sceneTwo");
        setNextSceneStartPoint(22);
        engineeringAccess();
    }, [])

    useFrame((state) => {
        const position = [
            state.camera.position.x,
            state.camera.position.y,
            state.camera.position.z,
        ];

        if (position[0] === targetPosition[0] && position[1] === targetPosition[1] && position[2] === targetPosition[2]) {
            if (!cameraReached) {
                setCameraReached(true);
            }
        } else {
            if (cameraReached) {
                setCameraReached(false);
            }
        }
    });

    return (

        <Suspense fallback={<WaitingForMoreModels />}>
            <camera position={startPosition} />
            <Text
                position={[0, -0.4, 3.75]}
                fontSize={0.1}
                color="white"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={!showComponents.loading}
            >
                Welcome to my gallery
            </Text>

            <Text
                position={[0, 3, 0.1]}
                fontSize={0.1}
                color="white"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={!showComponents.loading}
            >
                {"You have browsed " + (visitedIds.size + 1) + " out of " + (images.length + 1) + " websites that were built and designed by me."}
            </Text>



            <Text
                position={[0, 2.5, 0.1]}
                fontSize={0.2}
                color="white"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={showComponents.loading}
            >
                Time to head back to the bridge!
            </Text>
            <Text
                position={[0, 2, 0.1]}
                fontSize={0.2}
                color="white"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={showComponents.loading}
            >
                {"Head back in " + countDown + " seconds"}
            </Text>

            <Text
                position={[0, -0.1, 0.1]}
                fontSize={0.4}
                color="#00FFFF"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={showComponents.loading}
            >
                {"Disconnected\nfrom Tim's\nnamespace"}
            </Text>



            {!showComponents.loading && <>
                <color attach="background" args={['#191920']} />
                <fog attach="fog" args={['#191920', 0, 15]} />
                <group position={[0, -0.5, 0]}>
                    <Frames images={images} onVisit={(id) => setVisitedIds(new Set(visitedIds.add(id)))} />
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                        <planeGeometry args={[50, 50]} />
                        <MeshReflectorMaterial
                            blur={[300, 100]}
                            resolution={2048}
                            mixBlur={1}
                            mixStrength={80}
                            roughness={1}
                            depthScale={1.2}
                            minDepthThreshold={0.4}
                            maxDepthThreshold={1.4}
                            color="#050505"
                            metalness={0.5}
                        />
                    </mesh>
                </group>
                <Environment preset="city" /></>}

            {showComponents.loading && <>
                <color attach='background' args={["white"]} />

                <AnyModel modelURL="loading.glb" useTheatre={false} position={[-1.5, 0, 8]} rotation={[0, 0, 0]} scale={0.4} opacity={loadingOpacity} animationNames={["Take 01"]} animationAutoStart={true} animationStartPoint={0} />
                <ambientLight intensity={10} color={"white"} />
            </>
            }

        </Suspense>

    )
}
function Frames({ images, onVisit, q = new THREE.Quaternion(), p = new THREE.Vector3() }) {
    const ref = useRef()
    const clicked = useRef()
    const [, params] = useRoute('/ship_engineering/item/:id')
    const [, setLocation] = useLocation()
    useEffect(() => {
        clicked.current = ref.current.getObjectByName(params?.id)
        if (clicked.current) {
            clicked.current.parent.updateWorldMatrix(true, true)
            clicked.current.parent.localToWorld(p.set(0, GOLDENRATIO / 2, 1.25))
            clicked.current.parent.getWorldQuaternion(q)
        } else {
            p.set(0, 0, 5.5)
            q.identity()
        }
    })

    useEffect(() => {
        clicked.current = ref.current.getObjectByName(params?.id)
        if (clicked.current) {
            onVisit(params?.id); // 标记此ID为已访问
        }
    }, [params?.id])

    useFrame((state, dt) => {
        easing.damp3(state.camera.position, p, 0.4, dt)
        easing.dampQ(state.camera.quaternion, q, 0.4, dt)
    })
    return (
        <group
            ref={ref}
            onClick={(e) => (e.stopPropagation(), setLocation(clicked.current === e.object ? '/ship_engineering' : '/ship_engineering/item/' + e.object.name))}
            onPointerMissed={() => setLocation('/ship_engineering')}>
            {images.map((props) => <Frame key={props.url} {...props} /> /* prettier-ignore */)}
        </group>
    )
}

function Frame({ url, c = new THREE.Color(), ...props }) {
    const image = useRef()
    const frame = useRef()
    const [, params] = useRoute('/ship_engineering/item/:id')
    const [hovered, hover] = useState(false)
    const name = getUuid(url)
    const isActive = params?.id === name
    useCursor(hovered)
    useFrame((state, dt) => {
        image.current.material.zoom = 1.5 + Math.sin(state.clock.elapsedTime / 3) / 2;
        easing.damp3(image.current.scale, [0.85 * (!isActive && hovered ? 0.85 : 1), 0.9 * (!isActive && hovered ? 0.905 : 1), 1], 0.1, dt)
        easing.dampC(frame.current.material.color, hovered ? 'orange' : 'white', 0.1, dt)
    })
    return (
        <group {...props}>
            <mesh
                name={name}
                onPointerOver={(e) => (e.stopPropagation(), hover(true))}
                onPointerOut={() => hover(false)}
                scale={[1, GOLDENRATIO, 0.05]}
                position={[0, GOLDENRATIO / 2, 0]}>
                <boxGeometry />
                <meshStandardMaterial color="#151515" metalness={0.5} roughness={0.5} envMapIntensity={2} />
                <mesh ref={frame} raycast={() => null} scale={[0.9, 0.93, 0.9]} position={[0, 0, 0.2]}>
                    <boxGeometry />
                    <meshBasicMaterial toneMapped={false} fog={false} />
                </mesh>
                <Image raycast={() => null} ref={image} position={[0, 0, 0.7]} url={url} />
            </mesh>
            <Text maxWidth={0.1} anchorX="left" anchorY="top" position={[0.55, GOLDENRATIO, 0]} fontSize={0.025}>
                {props.project_name.split('-').join(' ')}
            </Text>
        </group >
    )
}
