import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getNextScene, getNextSceneURI } from "../pages/Status";
import { clearAllResumePositions } from "./useSequenceAutoSave";

export function useJumpToNextScene() {

    const navigate = useNavigate();

    const [isJumping, setIsJumping] = useState(false);

    const checkThenJumpToTheNextScene = useCallback(() => {
        if (!isJumping) {
            setIsJumping(true);
            clearAllResumePositions();
            navigate(getNextSceneURI(getNextScene()));
        }
    }, []);


    return { checkThenJumpToTheNextScene };
}
