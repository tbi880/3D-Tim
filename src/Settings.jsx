// settings.js

// Define the stage of the environment : dev, prod
const stageOfENV = "prod";

// Set the URL based on the environment stage
const url = stageOfENV === "prod" ? "https://www.bty.co.nz" : "http://localhost:5173";

const bucketURL = stageOfENV === "prod" ? "https://f005.backblazeb2.com/file/tim3Dweb/" : "/assets/";

const backendURL = stageOfENV === "prod" ? "https://api.bty.co.nz/" : "http://localhost:5130/";

const webGLPreserveDrawingBuffer = stageOfENV === "prod" ? false : true;

// Export the settings
export { stageOfENV, url, bucketURL, backendURL, webGLPreserveDrawingBuffer };
