import { vec3 } from "gl-matrix";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";

const cameraSpeed = 10;
const mouseSensitivity = 0.002;
const pitchLimit = Math.PI / 2 - 0.01;
const heldKeys = new Set<string>();
let mouseX = 0;
let mouseY = 0;

function clearMouseMovement() {
    mouseX = 0;
    mouseY = 0;
}

window.addEventListener("keydown", (event) => heldKeys.add(event.code));
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
window.addEventListener("blur", () => {
    heldKeys.clear();
    clearMouseMovement();
});

export function initializeCameraControls(canvas: HTMLCanvasElement) {
    canvas.addEventListener("click", async () => {
        if (document.pointerLockElement === canvas) return;

        try {
            await canvas.requestPointerLock();
        } catch (error) {
            console.warn("Could not capture the mouse:", error);
        }
    });

    document.addEventListener("pointerlockchange", clearMouseMovement);

    document.addEventListener("mousemove", (event) => {
        if (document.pointerLockElement !== canvas) return;

        // Collect mouse movement between frames.
        mouseX += event.movementX;
        mouseY += event.movementY;
    });
}

function updateCameraLook(transform: Transform) {
    if (mouseX === 0 && mouseY === 0) return;

    const [x, y, z] = vec3.subtract(vec3.create(), transform.target, transform.location);
    const yaw = Math.atan2(x, -z) + mouseX * mouseSensitivity;
    const nextPitch = Math.atan2(y, Math.hypot(x, z)) - mouseY * mouseSensitivity;
    // Keep the view direction from lining up with the up axis.
    const pitch = Math.max(-pitchLimit, Math.min(pitchLimit, nextPitch));
    clearMouseMovement();

    const forward: vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    transform.target = vec3.add(vec3.create(), transform.location, forward);
}

/** Updates game logic once per frame. Delta time is in seconds. */
export function updateGame(scene: Scene, dt: number): void {
    const transform = scene.getEntityByName("PlayerCamera")?.getComponent(Transform);
    if (!transform) return;

    // Keyboard movement follows the world axes.
    const dx = Number(heldKeys.has("KeyW")) - Number(heldKeys.has("KeyS"));
    const dy = Number(heldKeys.has("Space")) - Number(heldKeys.has("ShiftLeft"));
    const dz = Number(heldKeys.has("KeyA")) - Number(heldKeys.has("KeyD"));
    if (dx !== 0 || dy !== 0 || dz !== 0) {
        const step = cameraSpeed * dt;
        const offset: vec3 = [dx * step, dy * step, dz * step];
        // Move the look target with the camera to preserve its direction.
        transform.location = vec3.add([0, 0, 0], transform.location, offset);
        transform.target = vec3.add([0, 0, 0], transform.target, offset);
    }

    updateCameraLook(transform);
}
