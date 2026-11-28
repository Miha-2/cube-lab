import { mat4, quat, vec3 } from "gl-matrix";
import { BoxCollider } from "../components/BoxCollider.ts";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";

const collisionEpsilon = 1e-8;

type Interval = [min: number, max: number];
type BoxPlane = [normalY: number, normalZ: number, limit: number];
export type BoxBounds = { min: vec3; max: vec3 };

/** Keep world-space physics boxes aligned with their Blender proxy hierarchies. */
export function syncBoxColliders(scene: Scene) {
    for (const entity of scene.getEntitiesByComponent(BoxCollider)) {
        const source = entity.getComponent(BoxCollider)!.source;
        const transform = entity.getComponent(Transform);
        if (!source || !transform) continue;
        transform.location = mat4.getTranslation(vec3.create(), source.worldMatrix);
        const scale = mat4.getScaling(vec3.create(), source.worldMatrix);
        // Remove scale from each matrix column before extracting the rotation.
        // Otherwise a rotated, non-uniformly scaled box can produce a non-unit quaternion.
        const rotationMatrix = mat4.clone(source.worldMatrix);
        for (let column = 0; column < 3; column++) {
            for (let row = 0; row < 3; row++) {
                rotationMatrix[column * 4 + row] /= scale[column] || 1;
            }
        }
        transform.rotation = quat.normalize(quat.create(), mat4.getRotation(quat.create(), rotationMatrix));
        transform.scale = scale;
    }
}

/** World-aligned bounds for sweeping a movable box against the scene. */
export function getWorldBoxBounds(transform: Transform): BoxBounds {
    const x = vec3.transformQuat([0, 0, 0], [transform.scale[0], 0, 0], transform.rotation);
    const y = vec3.transformQuat([0, 0, 0], [0, transform.scale[1], 0], transform.rotation);
    const z = vec3.transformQuat([0, 0, 0], [0, 0, transform.scale[2]], transform.rotation);
    const halfSize: vec3 = [
        Math.abs(x[0]) + Math.abs(y[0]) + Math.abs(z[0]),
        Math.abs(x[1]) + Math.abs(y[1]) + Math.abs(z[1]),
        Math.abs(x[2]) + Math.abs(y[2]) + Math.abs(z[2]),
    ];
    return {
        min: vec3.subtract([0, 0, 0], transform.location, halfSize),
        max: vec3.add([0, 0, 0], transform.location, halfSize),
    };
}

/** First contact for an origin outside the box moving along a unit direction. */
export function getBoxHitDistance(origin: vec3, direction: vec3, { min, max }: BoxBounds, reach: number) {
    let entry = -Infinity;
    let exit = Infinity;
    for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(direction[axis]) <= collisionEpsilon) {
            if (origin[axis] <= min[axis] + collisionEpsilon || origin[axis] >= max[axis] - collisionEpsilon) return;
            continue;
        }
        const near = (min[axis] - origin[axis]) / direction[axis];
        const far = (max[axis] - origin[axis]) / direction[axis];
        entry = Math.max(entry, Math.min(near, far));
        exit = Math.min(exit, Math.max(near, far));
    }
    if (entry >= -collisionEpsilon && entry <= reach && exit > Math.max(0, entry)) {
        return Math.max(0, entry);
    }
}

export function clipMovingBox(location: vec3, target: vec3, halfSize: vec3, obstacles: BoxBounds[]) {
    const next = vec3.copy([0, 0, 0], location);
    const direction: vec3 = [0, 0, 0];
    const expandedObstacles = obstacles.map(({ min, max }) => ({
        min: vec3.subtract([0, 0, 0], min, halfSize),
        max: vec3.add([0, 0, 0], max, halfSize),
    }));
    // Resolve each axis separately so a box can slide along walls and along the floor.
    for (const axis of [0, 2, 1] as const) {
        const travel = target[axis] - next[axis];
        if (travel === 0) continue;
        direction[axis] = Math.sign(travel);
        let distance = Math.abs(travel);
        for (const obstacle of expandedObstacles) {
            distance = getBoxHitDistance(next, direction, obstacle, distance) ?? distance;
        }
        next[axis] += direction[axis] * distance;
        direction[axis] = 0;
    }
    return next;
}

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
    supportsPlayer: boolean;
    supportSlope: number | undefined;
};

function getSurfaceSlope(pitch: number, [normalY, normalZ]: BoxPlane) {
    // The expanded collider has a flat strip at the edge of an inclined face.
    return Math.abs(normalZ) <= collisionEpsilon ? pitch : Math.atan2(normalZ, normalY);
}

function getVerticalBoxSection(box: BoxContact, location: vec3) {
    const [x, , z] = vec3.rotateY([0, 0, 0], location, box.center, -box.yaw);
    if (isInside(x, box.xRange)) return getBoxSection(box.planes, 0, z - box.center[2]);
}

export function getPlayerBoxContacts(
    scene: Scene, location: vec3, eyeHeight: number, playerHalfWidth: number, headClearance = 0,
    unsupportedBox?: Transform
) {
    const boxes: BoxContact[] = [];
    for (const entity of scene.getEntitiesByComponent(BoxCollider)) {
        const transform = entity.getComponent(Transform);
        if (!transform) continue;
        const box = getBoxBounds(transform, eyeHeight, playerHalfWidth, headClearance);
        const [x, , z] = vec3.rotateY([0, 0, 0], location, box.center, -box.yaw);
        const surface = getBoxSection(box.planes, 0, z - box.center[2]);
        const supportsPlayer = transform !== unsupportedBox;
        let supportSlope: number | undefined;
        if (supportsPlayer && surface && isInside(x, box.xRange) &&
            Math.abs(location[1] - box.center[1] - surface.max) <= collisionEpsilon) {
            supportSlope = getSurfaceSlope(box.pitch, surface.upperPlane);
        }
        boxes.push({ ...box, x, z, supportsPlayer, supportSlope });
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
        const section = getVerticalBoxSection(box, next);
        if (!section) continue;
        const top = box.center[1] + section.max;
        if (box.supportsPlayer && (box.supportSlope !== undefined || location[1] >= top - collisionEpsilon)) {
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

export function tryPlayerStep(boxes: BoxContact[], location: vec3, desired: vec3, maxHeight: number, slopeLimit: number) {
    let stepY = location[1];
    for (const box of boxes) {
        if (!box.supportsPlayer) continue;
        const section = getVerticalBoxSection(box, desired);
        if (!section || Math.abs(getSurfaceSlope(box.pitch, section.upperPlane)) > slopeLimit) continue;
        const top = box.center[1] + section.max;
        if (top > stepY + collisionEpsilon && top - location[1] <= maxHeight + collisionEpsilon) {
            stepY = top;
        }
    }
    if (stepY === location[1]) return;

    // Check the lift at the starting position before retrying the horizontal move.
    for (const box of boxes) {
        const section = getVerticalBoxSection(box, location);
        if (!section) continue;
        const underside = box.center[1] + section.min;
        if (location[1] <= underside + collisionEpsilon && stepY > underside + collisionEpsilon) return;
    }

    const raised: vec3 = [location[0], stepY, location[2]];
    const stepped: vec3 = [desired[0], stepY, desired[2]];
    resolvePlayerBoxMovement(boxes, raised, stepped);
    if (Math.abs(stepped[0] - desired[0]) <= collisionEpsilon &&
        Math.abs(stepped[2] - desired[2]) <= collisionEpsilon) return stepped;
}
