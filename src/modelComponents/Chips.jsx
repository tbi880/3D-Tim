import { useEffect, useState } from "react";
import AnyModel from "./AnyModel";
import { SheetProvider } from "@theatre/r3f";

export default function Chips({ chipSheet, betValue }) {
    const showChipsNode_100 = {
        "Object_4": false,
        "Object_5": false,
        "Object_6": false,
        "Object_7": true,
        "Object_8": false,
        "Object_9": false,
        "Object_10": false,
    };

    const showChipsNode_1000 = {
        "Object_4": false,
        "Object_5": true,
        "Object_6": false,
        "Object_7": true,
        "Object_8": false,
        "Object_9": false,
        "Object_10": false,
    };

    const showChipsNode_10000 = {
        "Object_4": true,
        "Object_5": true,
        "Object_6": false,
        "Object_7": true,
        "Object_8": false,
        "Object_9": false,
        "Object_10": false,
    };

    const showChipsNode_50k = {
        "Object_4": true,
        "Object_5": true,
        "Object_6": false,
        "Object_7": true,
        "Object_8": false,
        "Object_9": true,
        "Object_10": false,
    };

    const showChipsNode_100k = {
        "Object_4": true,
        "Object_5": true,
        "Object_6": true,
        "Object_7": true,
        "Object_8": false,
        "Object_9": true,
        "Object_10": false,
    };

    const showChipsNode_1M = {
        "Object_4": true,
        "Object_5": true,
        "Object_6": true,
        "Object_7": true,
        "Object_8": false,
        "Object_9": true,
        "Object_10": true,
    };
    const [modelNodeLoadMap, setModelNodeLoadMap] = useState(null);

    useEffect(() => {
        if (betValue > 100000000) {
            setModelNodeLoadMap(null);
        } else if (betValue > 10000000) {
            setModelNodeLoadMap({ ...showChipsNode_1M });
        } else if (betValue > 1000001) {
            setModelNodeLoadMap({ ...showChipsNode_100k });
        } else if (betValue > 100000) {
            setModelNodeLoadMap({ ...showChipsNode_50k });
        } else if (betValue > 50000) {
            setModelNodeLoadMap({ ...showChipsNode_10000 });
        } else if (betValue > 10000) {
            setModelNodeLoadMap({ ...showChipsNode_1000 });
        } else {
            setModelNodeLoadMap({ ...showChipsNode_100 });
        }
    }, [betValue]);

    return <SheetProvider sheet={chipSheet}>
        <AnyModel modelURL={'casino/chips.glb'} sequence={chipSheet.sequence} useTheatre={true} theatreKey={"chip"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
        <AnyModel modelURL={'casino/chips.glb'} sequence={chipSheet.sequence} useTheatre={true} theatreKey={"chip_bet"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} modelNodeLoadMap={modelNodeLoadMap} />
        <AnyModel modelURL={'casino/chips.glb'} sequence={chipSheet.sequence} useTheatre={true} theatreKey={"chip_payout"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} modelNodeLoadMap={modelNodeLoadMap} />
    </SheetProvider>;
}