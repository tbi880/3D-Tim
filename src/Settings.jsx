// settings.js

// Define the stage of the environment : dev, prod
const stageOfENV = "prod";

// Set the URL based on the environment stage
const url = stageOfENV === "prod" ? "https://www.bty.co.nz/" : "https://192.168.18.138:5173/";

const bucketURL = stageOfENV === "prod" ? "https://assets.bty.co.nz/file/tim3Dweb/" : "/assets/";

const backendURL = stageOfENV === "prod" ? "https://api.bty.co.nz/" : "http://192.168.18.138:5133/";

const authURL = stageOfENV === "prod" ? "https://api.bty.co.nz/auth/" : "http://192.168.18.138:5133/auth/";

const roomURL = stageOfENV === "prod" ? "https://api.bty.co.nz/room/" : "http://192.168.18.138:5133/room/";

const signalRConnectionURL = stageOfENV === "prod" ? "https://api.bty.co.nz/connect" : "http://192.168.18.138:5133/connect";

const webGLPreserveDrawingBuffer = stageOfENV === "prod" ? false : true;

// Export the settings
export { stageOfENV, url, bucketURL, backendURL, authURL, roomURL, signalRConnectionURL, webGLPreserveDrawingBuffer };