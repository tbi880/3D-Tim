// settings.js

// Define the stage of the environment
const stageOfENV = "dev";

// Set the URL based on the environment stage
const url = stageOfENV === "dev" ? "http://localhost:5173" : "https://www.vit.ltd/tim";

const bucketURL = stageOfENV === "dev" ? "./assets/" : "https://f005.backblazeb2.com/file/tim3Dweb/";

// Export the settings
export { stageOfENV, url, bucketURL };
