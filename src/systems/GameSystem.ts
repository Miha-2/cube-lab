import { vec3 } from "gl-matrix";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";

const cameraSpeed = 7;
const groundY = 0;
const eyeHeight = 1.7;
const playerHalfWidth = 0.3;
const collisionEpsilon = 1e-8;
const gravity = 9.81;
const jumpSpeed = 6.3;
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

function updateVerticalPosition(cameraY: number, groundEyeY: number, dt: number) {
    if (jumpRequested && cameraY <= groundEyeY && verticalVelocity === 0) {
        verticalVelocity = jumpSpeed;
    }
    jumpRequested = false;

    const nextY = cameraY + verticalVelocity * dt - 0.5 * gravity * dt * dt;
    verticalVelocity -= gravity * dt;

    // Stop falling when the player's feet reach a surface.
    if (nextY <= groundEyeY) {
        verticalVelocity = 0;
        return groundEyeY;
    }
    return nextY;
}

function clipBoxAxis(location: vec3, next: number, axis: 0 | 2, min: vec3, max: vec3) {
    const otherAxis = axis === 0 ? 2 : 0;
    if (location[1] <= min[1] || location[1] >= max[1] ||
        location[otherAxis] <= min[otherAxis] + collisionEpsilon ||
        location[otherAxis] >= max[otherAxis] - collisionEpsilon) {
        return next;
    }

    const current = location[axis];
    if (current <= min[axis] + collisionEpsilon) return Math.min(next, min[axis]);
    if (current >= max[axis] - collisionEpsilon) return Math.max(next, max[axis]);
    return next;
}

function updateCameraMovement(transform: Transform, cube: Transform | undefined, dt: number) {
    if (dt <= 0) return;

    const forwardInput = Number(heldKeys.has("KeyW")) - Number(heldKeys.has("KeyS"));
    const rightInput = Number(heldKeys.has("KeyD")) - Number(heldKeys.has("KeyA"));

    // Project the view direction onto the horizontal plane for WASD.
    const forward = vec3.subtract([0, 0, 0], transform.target, transform.location);
    forward[1] = 0;
    vec3.normalize(forward, forward);
    const right: vec3 = [-forward[2], 0, forward[0]];

    const step = cameraSpeed * dt;
    const location = transform.location;
    const next = vec3.scaleAndAdd([0, 0, 0], location, forward, forwardInput * step);
    vec3.scaleAndAdd(next, next, right, rightInput * step);

    let groundEyeY = groundY + eyeHeight;
    if (cube) {
        // Expand the cube's bounds so the camera represents a player with width and height.
        const [x, y, z] = cube.location;
        const halfX = Math.abs(cube.scale[0]) + playerHalfWidth;
        const halfY = Math.abs(cube.scale[1]);
        const halfZ = Math.abs(cube.scale[2]) + playerHalfWidth;
        const min: vec3 = [x - halfX, y - halfY, z - halfZ];
        const max: vec3 = [x + halfX, y + halfY + eyeHeight, z + halfZ];

        // Align the movement with the box's local X and Z axes before clipping it.
        const boxAxis = vec3.transformQuat([0, 0, 0], [0, 0, 1], cube.rotation);
        const yaw = Math.atan2(boxAxis[0], boxAxis[2]);
        const boxLocation = vec3.rotateY([0, 0, 0], location, cube.location, -yaw);
        const boxNext = vec3.rotateY([0, 0, 0], next, cube.location, -yaw);
        boxLocation[1] = location[1];
        const clippedX = clipBoxAxis(boxLocation, boxNext[0], 0, min, max);
        boxLocation[0] = clippedX;
        const clippedZ = clipBoxAxis(boxLocation, boxNext[2], 2, min, max);

        if (clippedX !== boxNext[0] || clippedZ !== boxNext[2]) {
            vec3.rotateY(next, [clippedX, location[1], clippedZ], cube.location, yaw);
        }

        if (location[1] >= max[1] && clippedX > min[0] + collisionEpsilon &&
            clippedX < max[0] - collisionEpsilon && clippedZ > min[2] + collisionEpsilon &&
            clippedZ < max[2] - collisionEpsilon) {
            groundEyeY = Math.max(groundEyeY, max[1]);
        }
    }

    next[1] = updateVerticalPosition(location[1], groundEyeY, dt);
    const offset = vec3.subtract([0, 0, 0], next, location);
    if (offset[0] === 0 && offset[1] === 0 && offset[2] === 0) return;

    // Move the look target with the camera to preserve its direction.
    transform.location = next;
    transform.target = vec3.add([0, 0, 0], transform.target, offset);
}

/** Updates game logic once per frame. Delta time is in seconds. */
export function updateGame(scene: Scene, dt: number): void {
    const transform = scene.getEntityByName("PlayerCamera")?.getComponent(Transform);
    if (!transform) return;

    updateCameraLook(transform);
    const cube = scene.getEntityByName("Cube")?.getComponent(Transform);
    updateCameraMovement(transform, cube, dt);
}
