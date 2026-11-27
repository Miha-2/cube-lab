import { vec3 } from "gl-matrix";
import { BoxCollider } from "../components/BoxCollider.ts";
import { Transform } from "../components/Transform.ts";
import type { Scene } from "../Scene.ts";
import { clipMovingBox, getBoxHitDistance, getWorldBoxBounds, type BoxBounds } from "./BoxCollisionSystem.ts";

const pickupReach = 3;
const carryDistance = 1.9;
const gravity = 9.81;
const carryStates = new WeakMap<Scene, { held: boolean; fallSpeed: number }>();

export function getHeldCubeCollider(scene: Scene) {
    return carryStates.get(scene)?.held ? scene.getEntityByName("CUBE collider") : null;
}

export function updateCubeCarry(scene: Scene, camera: Transform, playerBounds: BoxBounds, interact: boolean, dt: number): "pickup" | "drop" | undefined {
    const cube = scene.getEntityByName("CUBE")?.getComponent(Transform);
    const colliderEntity = scene.getEntityByName("CUBE collider");
    const collider = colliderEntity?.getComponent(Transform);
    if (!cube || !collider) return;

    let state = carryStates.get(scene);
    if (!state) {
        state = { held: false, fallSpeed: 0 };
        carryStates.set(scene, state);
    }

    const obstacles: BoxBounds[] = [];
    for (const entity of scene.getEntitiesByComponent(BoxCollider)) {
        if (entity === colliderEntity) continue;
        const transform = entity.getComponent(Transform);
        if (transform) obstacles.push(getWorldBoxBounds(transform));
    }

    const forward = vec3.subtract([0, 0, 0], camera.target, camera.location);
    vec3.normalize(forward, forward);
    const bounds = getWorldBoxBounds(collider);
    const hit = state.held ? undefined : getBoxHitDistance(camera.location, forward, bounds, pickupReach);
    const canPickUp = hit !== undefined && !obstacles.some((box) =>
        getBoxHitDistance(camera.location, forward, box, hit) !== undefined);
    if (interact) {
        state.held = canPickUp;
        if (state.held) state.fallSpeed = 0;
    }

    const hint = state.held ? "drop" : canPickUp ? "pickup" : undefined;
    if (dt <= 0) return hint;
    const halfSize = vec3.subtract([0, 0, 0], bounds.max, bounds.min);
    vec3.scale(halfSize, halfSize, 0.5);

    const location = collider.location;
    const target = state.held
        ? vec3.scaleAndAdd([0, 0, 0], camera.location, forward, carryDistance)
        : vec3.copy([0, 0, 0], location);
    if (state.held) {
        const clearanceX = (playerBounds.max[0] - playerBounds.min[0]) / 2 + halfSize[0];
        const clearanceZ = (playerBounds.max[2] - playerBounds.min[2]) / 2 + halfSize[2];
        const clearance = Math.hypot(clearanceX, clearanceZ) + 0.01;
        const horizontal = Math.hypot(forward[0], forward[2]);
        if (horizontal * carryDistance < clearance) {
            // A steep look angle must leave room between the cube and the player's feet.
            const directionX = horizontal > 0 ? forward[0] / horizontal : 1;
            const directionZ = horizontal > 0 ? forward[2] / horizontal : 0;
            target[0] = camera.location[0] + directionX * clearance;
            target[2] = camera.location[2] + directionZ * clearance;
            target[1] = camera.location[1] + Math.sign(forward[1]) *
                Math.sqrt(Math.max(0, carryDistance ** 2 - clearance ** 2));
        }
    } else {
        target[1] -= state.fallSpeed * dt + 0.5 * gravity * dt ** 2;
        state.fallSpeed += gravity * dt;
    }

    obstacles.push(playerBounds);
    const next = clipMovingBox(location, target, halfSize, obstacles);
    if (!state.held && next[1] > target[1]) state.fallSpeed = 0;

    const offset = vec3.subtract([0, 0, 0], next, location);
    if (offset[0] === 0 && offset[1] === 0 && offset[2] === 0) return hint;
    collider.location = next;
    cube.location = vec3.add([0, 0, 0], cube.location, offset);
    return hint;
}
