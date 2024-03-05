
import { Helmet } from 'react-helmet';


// PreloadAssets组件
const PreloadAssets = () => {


    return (<>
        <Helmet>
            <link rel="preload" href="fonts/Play_Regular.json" as="fetch" type="application/json" crossorigin="anonymous"></link>
            <link rel="preload" href="fonts/Orbitron_Bold.json" as="fetch" type="application/json" crossorigin="anonymous"></link>
        </Helmet >
    </>);
};



export default PreloadAssets;