
import TextContent from "./TextContent";
import TextTitle_v2 from "./TextTitle_v2";


const PreloadAssets = () => {

    return (<>
        <TextTitle_v2 theatreKey="preload" text="preloading" color="#ffffff" size={0.5} position={[0, 0, 110]} rotation={[0, 0, 0]} />
        <TextContent title="preloading" order={0} lines={["1", "w"]} color="#ffffff" size={0.5} position={[0, 0, 110]} rotation={[0, 0, 0]} />
    </>);
};



export default PreloadAssets;