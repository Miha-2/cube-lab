import { vec3 } from "gl-matrix";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";
import { getPlayerBoxContacts, resolvePlayerBoxMovement, syncBoxColliders } from "./BoxCollisionSystem.ts";
import { updateCubeCarry } from "./CubeCarrySystem.ts";
import { computeTransforms } from "./TransformSystem.ts";

const cameraSpeed = 7;
const maxWalkableSlope = Math.PI / 6;
const slideSpeed = 3;
export const playerEyeHeight = 1.7;
const playerHalfWidth = 0.3;
const headClearance = 0.1;
const gravity = 9.81;
const jumpSpeed = 6.3;
const mouseSensitivity = 0.002;
const pitchLimit = Math.PI / 2 - 0.01;
const heldKeys = new Set<string>();
let mouseX = 0;
let mouseY = 0;
let jumpRequested = false;
let interactRequested = false;
let verticalVelocity = 0;

function clearMouseMovement() {
    mouseX = 0;
    mouseY = 0;
}

window.addEventListener("keydown", (event) => {
    heldKeys.add(event.code);
    if (event.code === "Space" && !event.repeat) jumpRequested = true;
    if (event.code === "KeyE" && !event.repeat) interactRequested = true;
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
window.addEventListener("blur", () => {
    heldKeys.clear();
    jumpRequested = false;
    interactRequested = false;
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

function updateVerticalPosition(
    cameraY: number,
    grounded: boolean,
    { groundEyeY, ceilingEyeY, followsSurface }: ReturnType<typeof resolvePlayerBoxMovement>,
    dt: number
) {
    const isJumping = jumpRequested && grounded && verticalVelocity === 0;
    jumpRequested = false;
    if (isJumping) {
        verticalVelocity = jumpSpeed;
    } else if (followsSurface && verticalVelocity === 0) {
        return groundEyeY;
    }

    let startY = cameraY;
    let remainingTime = dt;
    if (verticalVelocity > 0) {
        const timeAscending = Math.min(dt, verticalVelocity / gravity);
        const ascent = verticalVelocity * timeAscending - 0.5 * gravity * timeAscending ** 2;
        const distanceToCeiling = Math.max(0, ceilingEyeY - cameraY);
        if (ascent >= distanceToCeiling) {
            // Stop at impact, then fall for the rest of the frame.
            const impactSpeed = Math.sqrt(Math.max(0, verticalVelocity ** 2 - 2 * gravity * distanceToCeiling));
            const timeToImpact = 2 * distanceToCeiling / (verticalVelocity + impactSpeed);
            startY = ceilingEyeY;
            remainingTime = Math.max(0, dt - timeToImpact);
            verticalVelocity = 0;
        }
    }

    const nextY = startY + verticalVelocity * remainingTime - 0.5 * gravity * remainingTime ** 2;
    verticalVelocity -= gravity * remainingTime;

    // Stop falling when the player's feet reach a surface.
    if (nextY <= groundEyeY) {
        verticalVelocity = 0;
        return groundEyeY;
    }
    return nextY;
}

function updateCameraMovement(scene: Scene, transform: Transform, dt: number) {
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

    const boxes = getPlayerBoxContacts(scene, location, playerEyeHeight, playerHalfWidth, headClearance);
    const slopeLimit = maxWalkableSlope + 1e-6;
    const grounded = boxes.some(({ supportSlope }) => supportSlope !== undefined && Math.abs(supportSlope) <= slopeLimit);
    const steepBox = boxes.find(({ supportSlope }) => supportSlope !== undefined && Math.abs(supportSlope) > slopeLimit);
    if (!grounded && steepBox?.supportSlope !== undefined) {
        // Follow the steep face downhill using its local Z direction in world space.
        const sign = Math.sign(steepBox.supportSlope);
        const downhill: vec3 = [Math.sin(steepBox.yaw) * sign, 0, Math.cos(steepBox.yaw) * sign];
        vec3.scaleAndAdd(next, location, downhill, slideSpeed * dt);
    }

    const canStep = grounded && verticalVelocity === 0 && !jumpRequested;
    const surfaces = resolvePlayerBoxMovement(boxes, location, next, canStep ? 0.2 : 0);
    next[1] = updateVerticalPosition(location[1], grounded, surfaces, dt);
    const offset = vec3.subtract([0, 0, 0], next, location);
    if (offset[0] === 0 && offset[1] === 0 && offset[2] === 0) return;

    // Move the look target with the camera to preserve its direction.
    transform.location = next;
    transform.target = vec3.add([0, 0, 0], transform.target, offset);
}

/** Updates game logic once per frame. Delta time is in seconds. */
export function updateGame(scene: Scene, dt: number) {
    computeTransforms(scene);
    syncBoxColliders(scene);
    const transform = scene.getEntityByName("PlayerCamera")?.getComponent(Transform);
    if (!transform) return;

    updateCameraLook(transform);
    updateCameraMovement(scene, transform, dt);

    const [x, y, z] = transform.location;
    const cubeAction = updateCubeCarry(scene, transform, {
        min: [x - playerHalfWidth, y - playerEyeHeight, z - playerHalfWidth],
        max: [x + playerHalfWidth, y + headClearance, z + playerHalfWidth],
    }, interactRequested, dt);
    interactRequested = false;
    return cubeAction;
}
