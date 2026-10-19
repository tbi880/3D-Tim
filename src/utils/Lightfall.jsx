import { forwardRef, useEffect, useRef, useImperativeHandle } from 'react';
import { Renderer, Program, Mesh, Triangle } from 'ogl';
import '../Tools/css/lightfall.css';

const MAX_COLORS = 8;

const hexToRGB = hex => {
    const c = hex.replace('#', '').padEnd(6, '0');
    const r = parseInt(c.slice(0, 2), 16) / 255;
    const g = parseInt(c.slice(2, 4), 16) / 255;
    const b = parseInt(c.slice(4, 6), 16) / 255;
    return [r, g, b];
};

const prepColors = input => {
    const base = (input && input.length ? input : ['#A6C8FF', '#5227FF', '#FF9FFC']).slice(0, MAX_COLORS);
    const count = base.length;
    const arr = [];
    for (let i = 0; i < MAX_COLORS; i++) arr.push(hexToRGB(base[Math.min(i, base.length - 1)]));
    const avg = [0, 0, 0];
    for (let i = 0; i < count; i++) {
        avg[0] += arr[i][0];
        avg[1] += arr[i][1];
        avg[2] += arr[i][2];
    }
    avg[0] /= count;
    avg[1] /= count;
    avg[2] /= count;
    return { arr, count, avg };
};

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
precision highp float;

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

uniform vec3  uBgColor;
uniform vec3  uMouseColor;
uniform float uSpeed;
uniform int   uStreakCount;
uniform float uStreakWidth;
uniform float uStreakLength;
uniform float uGlow;
uniform float uDensity;
uniform float uTwinkle;
uniform float uZoom;
uniform float uBgGlow;
uniform float uOpacity;
uniform float uMouseEnabled;
uniform float uMouseStrength;
uniform float uMouseRadius;

varying vec2 vUv;

vec3 palette(float h) {
  int count = uColorCount;
  if (count < 1) count = 1;
  int idx = int(floor(clamp(h, 0.0, 0.999999) * float(count)));
  if (idx <= 0) return uColor0;
  if (idx == 1) return uColor1;
  if (idx == 2) return uColor2;
  if (idx == 3) return uColor3;
  if (idx == 4) return uColor4;
  if (idx == 5) return uColor5;
  if (idx == 6) return uColor6;
  return uColor7;
}

vec3 tanhv(vec3 x) {
  vec3 e = exp(-2.0 * x);
  return (1.0 - e) / (1.0 + e);
}

vec2 sceneC(vec2 frag, vec2 r) {
  vec2 P = (frag + frag - r) / r.x;
  float z = 0.0;
  float d = 1e3;
  vec4 O = vec4(0.0);
  for (int k = 0; k < 39; k++) {
    if (d <= 1e-4) break;
    O = z * normalize(vec4(P, uZoom, 0.0)) - vec4(0.0, 4.0, 1.0, 0.0) / 4.5;
    d = 1.0 - sqrt(length(O * O));
    z += d;
  }
  return vec2(O.x, atan(O.z, O.y));
}

void mainImage(out vec4 o, vec2 C) {
  vec2 r = iResolution.xy;
  vec2 uv0 = (C + C - r) / r.x;
  float T = 0.1 * iTime * uSpeed + 9.0;
  float angRings = max(1.0, floor(6.28318530718 * max(uDensity, 0.05) + 0.5));
  vec2 Y = vec2(5e-3, 6.28318530718 / angRings);

  vec2 c0 = sceneC(C, r);
  vec2 cdx = sceneC(C + vec2(1.0, 0.0), r);
  vec2 cdy = sceneC(C + vec2(0.0, 1.0), r);
  vec2 dCx = cdx - c0;
  vec2 dCy = cdy - c0;
  dCx.y -= 6.28318530718 * floor(dCx.y / 6.28318530718 + 0.5);
  dCy.y -= 6.28318530718 * floor(dCy.y / 6.28318530718 + 0.5);
  vec2 fw = abs(dCx) + abs(dCy);
  C = c0;

  vec2 P = vec2(2.0, 1.0) * uv0 - (r / r.x) * vec2(0.0, 1.0);
  vec4 O = vec4(uBgColor * 90.0 * uBgGlow / (1e3 * dot(P, P) + 6.0), 0.0);

  float mGlow = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mN = (iMouse + iMouse - r) / r.x;
    float md = length(uv0 - mN);
    mGlow = exp(-md * md / max(uMouseRadius * uMouseRadius, 1e-4)) * uMouseStrength;
    O.rgb += uMouseColor * mGlow * 0.25;
  }

  float zr = 5e-4 * uStreakWidth;
  vec2 rr = vec2(max(length(fw), 1e-5));
  float tail = 19.0 / max(uStreakLength, 0.05);

  for (int m = 0; m < 16; m++) {
    if (m >= uStreakCount) break;
    float jf = float(m) + 1.0;
    float ic = fract(sin(dot(vec2(jf, floor(C.x / Y.x + 0.5)), vec2(7.0, 11.0)) * 73.0));
    vec2 Pp = C - (T + T * ic) * vec2(0.0, 1.0);
    Pp -= floor(Pp / Y + 0.5) * Y;
    float h = fract(8663.0 * ic);
    vec3 col = palette(h);
    float weight = mix(1.5, 1.0 + sin(T + 7.0 * h + 4.0), uTwinkle);
    weight *= (1.0 + mGlow * 2.0);
    vec2 inner = vec2(length(max(Pp, vec2(-1.0, 0.0))), length(Pp) - zr) - zr;
    vec2 sm = vec2(1.0) - smoothstep(-rr, rr, inner);
    O.rgb += dot(sm, vec2(exp(tail * Pp.y), 3.0)) * col * weight;
    C.x += Y.x / 8.0;
  }

  vec3 colr = sqrt(tanhv(max(O.rgb * uGlow - vec3(0.04, 0.08, 0.02), 0.0)));
  o = vec4(colr, uOpacity);
}

void main() {
  vec4 color;
  mainImage(color, vUv * iResolution.xy);
  gl_FragColor = color;
}
`;

const DEFAULT_COLORS = ['#A6C8FF', '#5227FF', '#FF9FFC'];

// This effect fills the whole screen, so its drawing buffer is screen-sized.
// iPhones report devicePixelRatio 3; the soft glow looks the same at 2x and the
// buffer is less than half the size.
const MAX_LIGHTFALL_DPR = 2;
const defaultDpr = () => Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, MAX_LIGHTFALL_DPR);

const Lightfall = forwardRef(({
    className,
    dpr,
    paused = false,
    colors = DEFAULT_COLORS,
    backgroundColor = '#0A29FF',
    speed = 0.5,
    streakCount = 2,
    streakWidth = 1,
    streakLength = 1,
    glow = 1,
    density = 0.6,
    twinkle = 1,
    zoom = 3,
    backgroundGlow = 0.5,
    opacity = 1,
    mouseInteraction = true,
    mouseStrength = 0.5,
    mouseRadius = 1,
    mouseDampening = 0.15,
    mixBlendMode
}, ref) => {
    const containerRef = useRef(null);
    const programRef = useRef(null);
    // Read by the render loop every frame. Kept in a ref so that changing these props
    // never tears down and rebuilds the WebGL context.
    const liveRef = useRef({ paused, mouseInteraction, mouseDampening });

    useImperativeHandle(ref, () => ({
        setZoom(value) {
            if (programRef.current?.uniforms?.uZoom) {
                programRef.current.uniforms.uZoom.value = value;
            }
        }
    }));

    useEffect(() => {
        liveRef.current = { paused, mouseInteraction, mouseDampening };
    }, [paused, mouseInteraction, mouseDampening]);

    // One WebGL context per mounted Lightfall.
    // Previously the context was rebuilt whenever any prop changed (the loader flips
    // `mouseInteraction` when progress starts and again at 100%), and the old contexts
    // were never freed because ogl's Renderer has no destroy(). Every loading screen
    // therefore left three full-screen MSAA contexts alive (~115 MB each on an iPhone).
    // On iOS that memory is charged to the web page, and WebKit kills the page.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const renderer = new Renderer({
            dpr: dpr ?? defaultDpr(),
            alpha: true,
            antialias: false, // one full-screen triangle has no edges to smooth; MSAA only multiplies memory
            depth: false,
        });
        const gl = renderer.gl;
        const canvas = gl.canvas;

        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        container.appendChild(canvas);

        // Real values are written by the "sync props" effect below, which runs right after this one.
        const uniforms = {
            iResolution: { value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1] },
            iMouse: { value: [0, 0] },
            iTime: { value: 0 },
            uColor0: { value: [0, 0, 0] },
            uColor1: { value: [0, 0, 0] },
            uColor2: { value: [0, 0, 0] },
            uColor3: { value: [0, 0, 0] },
            uColor4: { value: [0, 0, 0] },
            uColor5: { value: [0, 0, 0] },
            uColor6: { value: [0, 0, 0] },
            uColor7: { value: [0, 0, 0] },
            uColorCount: { value: 1 },
            uBgColor: { value: [0, 0, 0] },
            uMouseColor: { value: [0, 0, 0] },
            uSpeed: { value: 0 },
            uStreakCount: { value: 1 },
            uStreakWidth: { value: 1 },
            uStreakLength: { value: 1 },
            uGlow: { value: 1 },
            uDensity: { value: 1 },
            uTwinkle: { value: 1 },
            uZoom: { value: zoom },
            uBgGlow: { value: 1 },
            uOpacity: { value: 1 },
            uMouseEnabled: { value: 0 },
            uMouseStrength: { value: 0 },
            uMouseRadius: { value: 1 }
        };

        const program = new Program(gl, { vertex, fragment, uniforms });
        programRef.current = program;

        const geometry = new Triangle(gl);
        const mesh = new Mesh(gl, { geometry, program });

        const resize = () => {
            const rect = container.getBoundingClientRect();
            renderer.setSize(rect.width, rect.height);
            uniforms.iResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight, 1];
        };

        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(container);

        let mouseTarget = [0, 0];
        const onPointerMove = e => {
            if (!liveRef.current.mouseInteraction) return;
            const rect = canvas.getBoundingClientRect();
            const scale = renderer.dpr || 1;
            const x = (e.clientX - rect.left) * scale;
            const y = (rect.height - (e.clientY - rect.top)) * scale;
            mouseTarget = [x, y];
            if (liveRef.current.mouseDampening <= 0) {
                uniforms.iMouse.value = [x, y];
            }
        };
        canvas.addEventListener('pointermove', onPointerMove);

        let rafId = 0;
        let lastTime = 0;
        const loop = t => {
            rafId = requestAnimationFrame(loop);
            uniforms.iTime.value = t * 0.001;
            const { paused: isPaused, mouseDampening: damping } = liveRef.current;
            if (damping > 0) {
                if (!lastTime) lastTime = t;
                const dt = (t - lastTime) / 1000;
                lastTime = t;
                const tau = Math.max(1e-4, damping);
                let factor = 1 - Math.exp(-dt / tau);
                if (factor > 1) factor = 1;
                const cur = uniforms.iMouse.value;
                cur[0] += (mouseTarget[0] - cur[0]) * factor;
                cur[1] += (mouseTarget[1] - cur[1]) * factor;
            } else {
                lastTime = t;
            }
            if (!isPaused) {
                try {
                    renderer.render({ scene: mesh });
                } catch (e) {
                    console.error(e);
                }
            }
        };
        rafId = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(rafId);
            canvas.removeEventListener('pointermove', onPointerMove);
            ro.disconnect();
            if (canvas.parentElement === container) {
                container.removeChild(canvas);
            }
            program.remove();
            geometry.remove();
            programRef.current = null;
            // ogl's Renderer has no destroy(). Shrink the drawing buffer and lose the
            // context explicitly, otherwise it lives until the GC collects the canvas.
            canvas.width = 1;
            canvas.height = 1;
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        };
        // Only the pixel ratio needs a new context; zoom is animated through setZoom().
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dpr]);

    // Sync props into the existing program instead of rebuilding the context.
    useEffect(() => {
        const u = programRef.current?.uniforms;
        if (!u) return;
        const { arr, count, avg } = prepColors(colors);
        for (let i = 0; i < MAX_COLORS; i++) u['uColor' + i].value = arr[i];
        u.uColorCount.value = count;
        u.uMouseColor.value = avg;
        u.uBgColor.value = hexToRGB(backgroundColor);
        u.uSpeed.value = speed;
        u.uStreakCount.value = Math.max(1, Math.min(16, Math.round(streakCount)));
        u.uStreakWidth.value = streakWidth;
        u.uStreakLength.value = streakLength;
        u.uGlow.value = glow;
        u.uDensity.value = density;
        u.uTwinkle.value = twinkle;
        u.uBgGlow.value = backgroundGlow;
        u.uOpacity.value = opacity;
        u.uMouseEnabled.value = mouseInteraction ? 1 : 0;
        u.uMouseStrength.value = mouseStrength;
        u.uMouseRadius.value = mouseRadius;
    }, [
        dpr,
        colors,
        backgroundColor,
        speed,
        streakCount,
        streakWidth,
        streakLength,
        glow,
        density,
        twinkle,
        backgroundGlow,
        opacity,
        mouseInteraction,
        mouseStrength,
        mouseRadius
    ]);

    return (
        <div
            ref={containerRef}
            className={`lightfall-container ${className ?? ''}`}
            style={{
                ...(mixBlendMode && { mixBlendMode })
            }}
        />
    );
});

export default Lightfall;
