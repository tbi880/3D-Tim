
import { Helmet } from 'react-helmet';
import { bucketURL } from '../Settings';

// PreloadAssets组件
const PreloadAssets = () => {

    const fontFile1 = bucketURL + "fonts/Play_Regular.json";
    const fontFile2 = bucketURL + "fonts/Orbitron_Bold.json";


    return (<>
        <Helmet>
            <link rel="preload" href={fontFile1} as="fetch" type="application/json" crossorigin="anonymous"></link>
            <link rel="preload" href={fontFile2} as="fetch" type="application/json" crossorigin="anonymous"></link>

        </Helmet >
    </>);
};



export default PreloadAssets;