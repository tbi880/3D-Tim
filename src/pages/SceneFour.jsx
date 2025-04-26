import { engineeringAccess, setNextScene, setNextSceneStartPoint } from './Status'
import * as THREE from 'three'
import { useContext, useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useCursor, MeshReflectorMaterial, Image, Text, Environment } from '@react-three/drei'
import { useRoute, useLocation } from 'wouter'
import { easing } from 'maath'
import getUuid from 'uuid-by-string'
import { Suspense } from 'react'
import Loader from './Loader'
import { bucketURL } from '../Settings'
import { TaskBoardContentContext } from '../sharedContexts/TaskBoardContentProvider'
import Loading from '../modelComponents/Loading'
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider'
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager'


const GOLDENRATIO = 1.61803398875

export const SceneFour = ({ scene4Sheet, images, isPortraitPhoneScreen, unloadPoint, onSequencePass }) => {
    const [visitedIds, setVisitedIds] = useState(new Set());
    const [cameraReached, setCameraReached] = useState(false);
    const startCameraPosition = [0, 2, 15];
    const targetCameraPosition = [0, 0, 5.5];
    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            loading: true,
        }, initialComponents: {
            loading: false,
        }
    });

    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);
    const { taskBoardContent, setTaskBoardContent } = useContext(TaskBoardContentContext);

    const [taskBoardContentMap, setTaskBoardContentMap] = useState({
        0: "Seems like I am inside of a gallery, I should check all the websites that Tim has built closely to show some respect.",
    });

    useEffect(() => {
        setTaskBoardContent(new Array(taskBoardContentMap[0]));
    }, []);


    useEffect(() => {
        let intervalId;

        if (visitedIds.size === images.length && cameraReached) {
            if (!showComponents.loading) {
                toggleComponentDisplay("loading");
                playOnce({ sequence: scene4Sheet.sequence, range: [0, 3] });
            }

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

        if (position[0] === targetCameraPosition[0] && position[1] === targetCameraPosition[1] && position[2] === targetCameraPosition[2]) {
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

        <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["Now you'll see some of my previous work", "treat it as a museum, a gallery", "Check them all, then I will bring you back with half of the access to my command chamber."]} />}>
            <camera position={startCameraPosition} makeDefault />
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
                position={[0, 3.25, 0.1]}
                fontSize={0.15}
                color="white"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={!showComponents.loading}
            >
                {"You have browsed "}
            </Text>
            <Text
                position={[0, 3, 0.1]}
                fontSize={0.25}
                color="white"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={!showComponents.loading}
            >
                {(visitedIds.size + 1) + " out of " + (images.length + 1) + " websites "}
            </Text>
            <Text
                position={[0, 2.75, 0.1]}
                fontSize={0.15}
                color="white"
                maxWidth={200}
                lineHeight={1}
                anchorX="center"
                anchorY="middle"
                visible={!showComponents.loading}
            >
                {"that were built & designed & optimized by me."}
            </Text>

            {!showComponents.loading &&
                <>
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
                </>
            }
            <Environment files={bucketURL + 'pic/city.hdr'} background={false} resolution={512} />

            {showComponents.loading && <>
                <Loading THkey="BackToSceneTwo" title="BackToSceneTwo" lines={["Disconnected", "from Tim's", "namespace"]} position={[-1.5, 0, 8]} rotation={[0, 0, 0]} sequence={scene4Sheet.sequence} unloadPoint={3} onSequencePass={onSequencePass} textTitleVersion={2} />
                <ambientLight intensity={5} color={"white"} />
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
            clicked.current.parent.localToWorld(p.set(0, GOLDENRATIO / 2, 1.5))
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
            <Text maxWidth={0.1} anchorX="center" anchorY="middle" position={[0, GOLDENRATIO + 0.15, 0]} fontSize={0.025}>
                {props.project_name.split('-').join(' ')}
            </Text>
        </group >
    )
}
