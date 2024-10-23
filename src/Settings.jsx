// settings.js

// Define the stage of the environment : building(可以直接在Scene manager里面设置跳到某个scene), dev（可以调试全部的Scene但是必须从第一个开始）, prod
const stageOfENV = "prod";

// Set the URL based on the environment stage
const url = stageOfENV === "prod" ? "https://www.bty.co.nz" : "http://localhost:5173";

const bucketURL = stageOfENV === "prod" ? "https://f005.backblazeb2.com/file/tim3Dweb/" : "/assets/";

const webGLPreserveDrawingBuffer = stageOfENV === "prod" ? false : true;

// Export the settings
export { stageOfENV, url, bucketURL, webGLPreserveDrawingBuffer };
