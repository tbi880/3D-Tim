import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

export function TheatreXRDriver({ driver }) {
    const { gl } = useThree();

    useEffect(() => {
        const onStart = () => {
            const session = gl.xr.getSession();

            if (!session) return;

            let stopped = false;

            const loop = (time, frame) => {
                if (stopped) return;
                driver.tick(time);
                frame.session.requestAnimationFrame(loop);
            };

            session.requestAnimationFrame(loop);

            const onEnd = () => {
                stopped = true;
                session.removeEventListener("end", onEnd);
            };

            session.addEventListener("end", onEnd);
        };

        gl.xr.addEventListener("sessionstart", onStart);

        return () => {
            gl.xr.removeEventListener("sessionstart", onStart);
        };
    }, [gl, driver]);

    return null;
}