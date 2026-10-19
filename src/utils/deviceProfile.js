// Device-specific memory limits for the 3D scenes.
//
// iOS / iPadOS give every web page a hard memory budget, and WebGL textures, render
// targets and canvases count towards it. When a page goes over, WebKit kills the page
// process immediately: no JS error, nothing in the console. Safari then reloads the page
// and shows "This webpage was reloaded because a problem occurred". Every browser on
// iOS runs on WebKit, so Chrome, Edge and the rest hit the same limit.

const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

export const isIOSDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ Safari presents itself as a desktop Mac; a Mac has no touch points.
    (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isIPad = isIOSDevice && !/iPhone|iPod/.test(ua);

// Longest side allowed for textures inside glTF models on iOS. Larger ones are downscaled
// once while loading, before they reach the GPU. A 4096² texture costs 64 MB (+21 MB
// mipmaps) of GPU memory and another 64 MB for the decoded image; at 1024² it is 4 MB.
// Desktop and Android keep the original resolution.
export const IOS_MAX_TEXTURE_SIZE = isIPad ? 2048 : 1024;

// Upper bound for the main canvas pixel ratio on iOS (the graphics menu allows up to 2).
export const IOS_MAX_DPR = 1.5;
