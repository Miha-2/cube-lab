import { vec3 } from "gl-matrix";
import { BoxCollider } from "../components/BoxCollider.ts";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";

const collisionEpsilon = 1e-8;

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

function getBoxBounds(transform: Transform, eyeHeight: number, playerHalfWidth: number, headClearance: number) {
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
            Math.max(ny * eyeHeight, -ny * headClearance) + Math.abs(nz) * playerHalfWidth,
    ]);
    const xRange: Interval = [x - halfX, x + halfX];
    return { center: transform.location, xRange, planes, yaw, pitch };
}

// Intersect the planes with a line at a fixed Y or Z coordinate.
function getBoxSection(planes: BoxPlane[], axis: 0 | 1, fixed: number) {
    let min = -Infinity;
    let max = Infinity;
    let upperPlane: BoxPlane | undefined;
    for (const plane of planes) {
        const coefficient = plane[axis];
        const remaining = plane[2] - plane[axis === 0 ? 1 : 0] * fixed;
        if (Math.abs(coefficient) <= collisionEpsilon) {
            if (remaining <= collisionEpsilon) return;
        } else if (coefficient > 0) {
            const limit = remaining / coefficient;
            if (limit < max) {
                max = limit;
                upperPlane = plane;
            }
        } else {
            min = Math.max(min, remaining / coefficient);
        }
    }
    if (upperPlane && min + collisionEpsilon < max) return { min, max, upperPlane };
}

type BoxContact = ReturnType<typeof getBoxBounds> & {
    x: number;
    z: number;
    supportSlope: number | undefined;
};

export function getPlayerBoxContacts(scene: Scene, location: vec3, eyeHeight: number, playerHalfWidth: number, headClearance = 0) {
    const boxes: BoxContact[] = [];
    for (const entity of scene.getEntitiesByComponent(BoxCollider)) {
        const transform = entity.getComponent(Transform);
        if (!transform) continue;
        const box = getBoxBounds(transform, eyeHeight, playerHalfWidth, headClearance);
        const [x, , z] = vec3.rotateY([0, 0, 0], location, box.center, -box.yaw);
        const surface = getBoxSection(box.planes, 0, z - box.center[2]);
        let supportSlope: number | undefined;
        if (surface && isInside(x, box.xRange) &&
            Math.abs(location[1] - box.center[1] - surface.max) <= collisionEpsilon) {
            const [normalY, normalZ] = surface.upperPlane;
            // The expanded collider has a flat strip at the edge of an inclined face.
            supportSlope = Math.abs(normalZ) <= collisionEpsilon ? box.pitch : Math.atan2(normalZ, normalY);
        }
        boxes.push({ ...box, x, z, supportSlope });
    }
    return boxes;
}

/** Clips the horizontal position and finds the nearest surfaces below and above it. */
export function resolvePlayerBoxMovement(boxes: BoxContact[], location: vec3, next: vec3) {
    for (const box of boxes) {
        const horizontalSection = getBoxSection(box.planes, 1, location[1] - box.center[1]);
        if (!horizontalSection || box.supportSlope !== undefined) continue;
        const zRange: Interval = [box.center[2] + horizontalSection.min, box.center[2] + horizontalSection.max];

        // Align movement with the box's local X and Z axes before clipping it.
        const boxNext = vec3.rotateY([0, 0, 0], next, box.center, -box.yaw);
        const clippedX = isInside(box.z, zRange) ? clipBoxAxis(box.x, boxNext[0], box.xRange) : boxNext[0];
        const clippedZ = isInside(clippedX, box.xRange) ? clipBoxAxis(box.z, boxNext[2], zRange) : boxNext[2];
        if (clippedX !== boxNext[0] || clippedZ !== boxNext[2]) {
            vec3.rotateY(next, [clippedX, location[1], clippedZ], box.center, box.yaw);
        }
    }

    // Check vertical surfaces at the resolved horizontal position.
    let groundEyeY = -Infinity;
    let ceilingEyeY = Infinity;
    let followsSurface = false;
    for (const box of boxes) {
        const [x, , z] = vec3.rotateY([0, 0, 0], next, box.center, -box.yaw);
        if (!isInside(x, box.xRange)) continue;
        const section = getBoxSection(box.planes, 0, z - box.center[2]);
        if (!section) continue;
        const top = box.center[1] + section.max;
        if (box.supportSlope !== undefined || location[1] >= top - collisionEpsilon) {
            groundEyeY = Math.max(groundEyeY, top);
            followsSurface ||= box.supportSlope !== undefined;
        }
        const bottom = box.center[1] + section.min;
        if (location[1] <= bottom + collisionEpsilon) {
            ceilingEyeY = Math.min(ceilingEyeY, bottom);
        }
    }
    return { groundEyeY, ceilingEyeY, followsSurface };
}
