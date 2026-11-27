import { mat4, vec4 } from "gl-matrix";
import { RenderState } from "./RenderState.ts";
import { updateBuffers } from "./systems/BufferUpdateSystem.ts";
import { prepareRendering } from "./systems/PrepareRenderSystem.ts";
import { render } from "./systems/RenderSystem.ts";
import { computeTransforms } from "./systems/TransformSystem.ts";
import { animate as animateScene } from "./systems/AnimationSystem.ts";
import { createBuffers } from "./systems/BufferInitSystem.ts";
import { Camera } from "./components/Camera.ts";
import { Transform } from "./components/Transform.ts";
import { computeSkins } from "./systems/SkinningSystem.ts";
import { createStarterScene } from "./StarterScene.ts";
import { getWorldBoxBounds } from "./systems/BoxCollisionSystem.ts";
import { initializeCameraControls, updateGame } from "./systems/GameSystem.ts";


// ------ Create sample scene ------ //

const scene = await createStarterScene();


// ------ Initalize GPU/Rendering specific interfaces ------ //

if (!navigator.gpu) {
    throw Error("WebGPU not supported in this browser!");
}
const gpuAdapter = await navigator.gpu.requestAdapter();
if (!gpuAdapter) {
    throw Error("Could not get WebGPU adapter!");
}
const gpuDevice = await gpuAdapter.requestDevice();
gpuDevice.addEventListener('uncapturederror', (e) => console.error(e.error.message));
gpuDevice.lost.then((v) => {
    console.error(`GPU device lost: ${v.message} (${v.reason})`);
});

const canvas = document.querySelector('canvas');
if (!canvas) {
    throw Error("Could not find a canvas!");
}
const renderState = new RenderState(gpuDevice, canvas);


// ------ Create and write all buffers ------ //

createBuffers(renderState, scene);


// ------ Prepare pipelines ------ //

await prepareRendering(renderState, scene);


// ------ Events ------ //

initializeCameraControls(canvas);

function resize() {
    if (!canvas) {
        return;
    }
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    if (width === 0 || height === 0) {
        width = 1;
        height = 1;
    }

    let aspect = width / height;

    // Update the camera
    const cameraEntities = scene?.getEntitiesByComponent(Camera) ?? [];
    for (const cameraEntity of cameraEntities) {
        const camera = cameraEntity.getComponent(Camera)!;
        camera.aspect = aspect;
    }
    // Update the rendering textures
    renderState.updateRenderTextureSizes(width, height);
}

window.addEventListener('resize', (_) => resize());
resize();


// ------ Start game loop ------ //

const interactionHint = document.getElementById("interaction-hint");
const interactionAction = document.getElementById("interaction-action");
const cubeCollider = scene.getEntityByName("CUBE collider")?.getComponent(Transform);
const renderCameraEntity = scene.getEntitiesByComponent(Camera)[0];
const renderCamera = renderCameraEntity?.getComponent(Camera);
const renderCameraTransform = renderCameraEntity?.getComponent(Transform);
const viewProjection = mat4.create();
const clipPoint = vec4.create();
let lastCubeAction: ReturnType<typeof updateGame>;

function updateInteractionHint(cubeAction: ReturnType<typeof updateGame>) {
    if (!interactionHint || !interactionAction) return;
    const view = renderCameraTransform?.viewMatrix;
    if (!cubeAction || !cubeCollider || !renderCamera || !view) {
        interactionHint.hidden = true;
        return;
    }

    const { min, max } = getWorldBoxBounds(cubeCollider);
    mat4.multiply(viewProjection, renderCamera.perspectiveProjection, view);
    let left = Infinity;
    let right = -Infinity;
    let top = -Infinity;

    // Project the corners so the label clears the cube even when viewed at an angle.
    for (const x of [min[0], max[0]]) {
        for (const y of [min[1], max[1]]) {
            for (const z of [min[2], max[2]]) {
                vec4.set(clipPoint, x, y, z, 1);
                vec4.transformMat4(clipPoint, clipPoint, viewProjection);
                const [clipX, clipY, depth, w] = clipPoint;
                if (w <= 0 || depth < 0 || depth > w) continue;
                left = Math.min(left, clipX / w);
                right = Math.max(right, clipX / w);
                top = Math.max(top, clipY / w);
            }
        }
    }

    const center = (left + right) / 2;
    if (!Number.isFinite(center) || Math.abs(center) > 1 || Math.abs(top) > 1) {
        interactionHint.hidden = true;
        return;
    }

    const rect = renderState.canvas.getBoundingClientRect();
    interactionHint.style.left = `${rect.left + (center + 1) * rect.width / 2}px`;
    interactionHint.style.top = `${rect.top + (1 - top) * rect.height / 2}px`;
    if (cubeAction !== lastCubeAction) {
        interactionAction.textContent = cubeAction === "drop" ? "Odloži" : "Poberi";
        lastCubeAction = cubeAction;
    }
    interactionHint.hidden = false;
}

let lastTime = performance.now();
function update(timestamp: number) {
    if (!scene) {
        return;
    }

    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    animateScene(scene, dt);
    const cubeAction = updateGame(scene, dt);
    computeTransforms(scene);
    updateInteractionHint(cubeAction);
    computeSkins(scene);
    updateBuffers(renderState, scene);

    render(renderState, scene);

    requestAnimationFrame(update);
}

requestAnimationFrame(update);
