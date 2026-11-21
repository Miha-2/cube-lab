import { vec3 } from "gl-matrix";
import { BoxCollider } from "../components/BoxCollider.ts";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";

const cameraSpeed = 7;
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

function updateVerticalPosition(cameraY: number, groundEyeY: number, grounded: boolean, followsSurface: boolean, dt: number) {
    const isJumping = jumpRequested && grounded && verticalVelocity === 0;
    jumpRequested = false;
    if (isJumping) {
        verticalVelocity = jumpSpeed;
    } else if (followsSurface && verticalVelocity === 0) {
        return groundEyeY;
    }

    const nextY = cameraY + verticalVelocity * dt - 0.5 * gravity * dt * dt;
    verticalVelocity -= gravity * dt;

    // Stop falling when the player's feet reach a surface.
    if (nextY <= groundEyeY) {
        verticalVelocity = 0;
        return groundEyeY;
    }
    return nextY;
}

type Interval = [min: number, max: number];
type BoxPlane = [normalY: number, normalZ: number, limit: number];

function isInside(value: number, [min, max]: Interval) {
    return value > min + collisionEpsilon && value < max - collisionEpsilon;
}

function clipBoxAxis(current: number, next: number, [min, max]: Interval) {
    if (current <= min + collisionEpsilon) return Math.min(next, min);
    if (current >= max - collisionEpsilon) return Math.max(next, max);
    return next;
}

function getBoxBounds(transform: Transform) {
    const [x] = transform.location;
    const halfX = Math.abs(transform.scale[0]) + playerHalfWidth;
    const halfY = Math.abs(transform.scale[1]);
    const halfZ = Math.abs(transform.scale[2]);
    const right = vec3.transformQuat([0, 0, 0], [1, 0, 0], transform.rotation);
    const front = vec3.transformQuat([0, 0, 0], [0, 0, 1], transform.rotation);
    const yaw = Math.atan2(-right[2], right[0]);
    const pitch = Math.atan2(-front[1], Math.hypot(front[0], front[2]));
    const cos = Math.cos(pitch);
    const sin = Math.sin(pitch);

    // In the box's yaw frame, expand its YZ section by the upright player dimensions.
    const planes: BoxPlane[] = [[1, 0], [-1, 0], [0, 1], [0, -1],
        [cos, sin], [-cos, -sin], [-sin, cos], [sin, -cos]].map(([ny, nz]) => [
        ny, nz,
        halfY * Math.abs(ny * cos + nz * sin) + halfZ * Math.abs(-ny * sin + nz * cos) +
            Math.max(0, ny * eyeHeight) + Math.abs(nz) * playerHalfWidth,
    ]);
    const xRange: Interval = [x - halfX, x + halfX];
    return { center: transform.location, xRange, planes, yaw };
}

// Intersect the planes with a line at a fixed Y or Z coordinate.
function getBoxSection(planes: BoxPlane[], axis: 0 | 1, fixed: number): Interval | undefined {
    let min = -Infinity;
    let max = Infinity;
    for (const plane of planes) {
        const coefficient = plane[axis];
        const remaining = plane[2] - plane[axis === 0 ? 1 : 0] * fixed;
        if (Math.abs(coefficient) <= collisionEpsilon) {
            if (remaining <= collisionEpsilon) return;
        } else if (coefficient > 0) {
            max = Math.min(max, remaining / coefficient);
        } else {
            min = Math.max(min, remaining / coefficient);
        }
    }
    if (min + collisionEpsilon < max) return [min, max];
}

function resolveBoxCollisions(scene: Scene, location: vec3, next: vec3) {
    const boxes = [];
    for (const entity of scene.getEntitiesByComponent(BoxCollider)) {
        const transform = entity.getComponent(Transform);
        if (!transform) continue;
        const box = getBoxBounds(transform);
        const [x, , z] = vec3.rotateY([0, 0, 0], location, box.center, -box.yaw);
        const currentHeight = getBoxSection(box.planes, 0, z - box.center[2])?.[1];
        const standingOnBox = currentHeight !== undefined && isInside(x, box.xRange) &&
            Math.abs(location[1] - box.center[1] - currentHeight) <= collisionEpsilon;
        boxes.push({ ...box, standingOnBox });

        const horizontalSection = getBoxSection(box.planes, 1, location[1] - box.center[1]);
        if (!horizontalSection || standingOnBox) continue;
        const zRange: Interval = [box.center[2] + horizontalSection[0], box.center[2] + horizontalSection[1]];

        // Align movement with the box's local X and Z axes before clipping it.
        const boxNext = vec3.rotateY([0, 0, 0], next, box.center, -box.yaw);
        const clippedX = isInside(z, zRange) ? clipBoxAxis(x, boxNext[0], box.xRange) : boxNext[0];
        const clippedZ = isInside(clippedX, box.xRange) ? clipBoxAxis(z, boxNext[2], zRange) : boxNext[2];
        if (clippedX !== boxNext[0] || clippedZ !== boxNext[2]) {
            vec3.rotateY(next, [clippedX, location[1], clippedZ], box.center, box.yaw);
        }
    }

    // Use the highest surface under the resolved horizontal position.
    let groundEyeY = -Infinity;
    let followsSurface = false;
    for (const box of boxes) {
        const [x, , z] = vec3.rotateY([0, 0, 0], next, box.center, -box.yaw);
        if (!isInside(x, box.xRange)) continue;
        const section = getBoxSection(box.planes, 0, z - box.center[2]);
        if (!section) continue;
        const top = box.center[1] + section[1];
        if (box.standingOnBox || location[1] >= top - collisionEpsilon) {
            groundEyeY = Math.max(groundEyeY, top);
            followsSurface ||= box.standingOnBox;
        }
    }
    const grounded = boxes.some((box) => box.standingOnBox);
    return { groundEyeY, grounded, followsSurface };
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

    const { groundEyeY, grounded, followsSurface } = resolveBoxCollisions(scene, location, next);
    next[1] = updateVerticalPosition(location[1], groundEyeY, grounded, followsSurface, dt);
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
    updateCameraMovement(scene, transform, dt);
}
