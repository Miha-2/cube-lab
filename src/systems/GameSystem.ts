import { vec3 } from "gl-matrix";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";

const cameraSpeed = 7;
const groundY = 0;
const eyeHeight = 1.7;
const gravity = 9.81;
const jumpSpeed = 4.5;
const mouseSensitivity = 0.002;
const pitchLimit = Math.PI / 2 - 0.01;
const heldKeys = new Set<string>();
let mouseX = 0;
let mouseY = 0;
let jumpRequested = false;
let verticalVelocity = 0;

function clearMouseMovement() {
    mouseX = 0;
    mouseY = 0;
}

window.addEventListener("keydown", (event) => {
    heldKeys.add(event.code);
    if (event.code === "Space" && !event.repeat) jumpRequested = true;
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
window.addEventListener("blur", () => {
    heldKeys.clear();
    jumpRequested = false;
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

function updateJump(cameraY: number, dt: number) {
    if (dt <= 0) return 0;

    const groundEyeY = groundY + eyeHeight;
    if (jumpRequested && cameraY <= groundEyeY && verticalVelocity === 0) {
        verticalVelocity = jumpSpeed;
    }
    jumpRequested = false;

    const nextY = cameraY + verticalVelocity * dt - 0.5 * gravity * dt * dt;
    verticalVelocity -= gravity * dt;

    // Land with the player's feet on the ground plane.
    if (nextY <= groundEyeY) {
        verticalVelocity = 0;
        return groundEyeY - cameraY;
    }
    return nextY - cameraY;
}

function updateCameraMovement(transform: Transform, dt: number) {
    const forwardInput = Number(heldKeys.has("KeyW")) - Number(heldKeys.has("KeyS"));
    const rightInput = Number(heldKeys.has("KeyD")) - Number(heldKeys.has("KeyA"));
    const verticalOffset = updateJump(transform.location[1], dt);
    if (forwardInput === 0 && rightInput === 0 && verticalOffset === 0) return;

    // Project the view direction onto the horizontal plane for WASD.
    const forward = vec3.subtract([0, 0, 0], transform.target, transform.location);
    forward[1] = 0;
    vec3.normalize(forward, forward);
    const right: vec3 = [-forward[2], 0, forward[0]];

    const step = cameraSpeed * dt;
    const offset: vec3 = [0, verticalOffset, 0];
    vec3.scaleAndAdd(offset, offset, forward, forwardInput * step);
    vec3.scaleAndAdd(offset, offset, right, rightInput * step);

    // Move the look target with the camera to preserve its direction.
    transform.location = vec3.add([0, 0, 0], transform.location, offset);
    transform.target = vec3.add([0, 0, 0], transform.target, offset);
}

/** Updates game logic once per frame. Delta time is in seconds. */
export function updateGame(scene: Scene, dt: number): void {
    const transform = scene.getEntityByName("PlayerCamera")?.getComponent(Transform);
    if (!transform) return;

    updateCameraLook(transform);
    updateCameraMovement(transform, dt);
}
