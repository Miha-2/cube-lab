import { mat3, mat4, vec3 } from "gl-matrix";
import { BoxCollider } from "../components/BoxCollider.ts";
import { Carryable } from "../components/Carryable.ts";
import { Transform } from "../components/Transform.ts";
import type { Entity } from "../Entity.ts";
import type { Scene } from "../Scene.ts";
import { clipMovingBox, getBoxHitDistance, getWorldBoxBounds, type BoxBounds } from "./BoxCollisionSystem.ts";

const pickupReach = 3;
const carryDistance = 1.9;
const gravity = 9.81;
const carryStates = new WeakMap<Scene, { held?: Entity; target?: Entity }>();

export function getHeldCubeCollider(scene: Scene) {
    return carryStates.get(scene)?.held?.getComponent(Carryable)?.collider;
}

export function getCubeInteractionTarget(scene: Scene) {
    return carryStates.get(scene)?.target?.getComponent(Carryable)?.collider;
}

export function updateCubeCarry(scene: Scene, camera: Transform, playerBounds: BoxBounds, interact: boolean, dt: number): "pickup" | "drop" | undefined {
    let state = carryStates.get(scene);
    if (!state) {
        state = {};
        carryStates.set(scene, state);
    }
    const cubes = scene.getEntitiesByComponent(Carryable);
    const colliders = scene.getEntitiesByComponent(BoxCollider)
        .map(entity => entity.getComponent(Transform)!)
        .filter(Boolean);
    const forward = vec3.subtract(vec3.create(), camera.target, camera.location);
    vec3.normalize(forward, forward);

    let candidate: Entity | undefined;
    let nearest = pickupReach;
    if (!state.held) {
        for (const entity of cubes) {
            const collider = entity.getComponent(Carryable)!.collider;
            if (!collider) continue;
            const hit = getBoxHitDistance(camera.location, forward, getWorldBoxBounds(collider), nearest);
            if (hit === undefined || colliders.some(other => other !== collider &&
                getBoxHitDistance(camera.location, forward, getWorldBoxBounds(other), hit) !== undefined)) continue;
            candidate = entity;
            nearest = hit;
        }
    }
    if (interact) {
        state.held = state.held ? undefined : candidate;
        if (state.held) state.held.getComponent(Carryable)!.fallSpeed = 0;
    }
    state.target = state.held ?? candidate;
    const hint = state.held ? "drop" : candidate ? "pickup" : undefined;
    if (dt <= 0) return hint;

    // Each cube falls independently; only the selected cube follows the camera.
    for (const entity of cubes) {
        const carryable = entity.getComponent(Carryable)!;
        const collider = carryable.collider;
        const cube = entity.getComponent(Transform);
        if (!collider || !cube) continue;
        const held = state.held === entity;
        const location = collider.location;
        const bounds = getWorldBoxBounds(collider);
        const halfSize = vec3.subtract(vec3.create(), bounds.max, bounds.min);
        vec3.scale(halfSize, halfSize, 0.5);
        const target = held
            ? vec3.scaleAndAdd(vec3.create(), camera.location, forward, carryDistance)
            : vec3.clone(location);
        if (held) {
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
            target[1] -= carryable.fallSpeed * dt + 0.5 * gravity * dt ** 2;
            carryable.fallSpeed += gravity * dt;
        }
        const obstacles = colliders.filter(other => other !== collider).map(getWorldBoxBounds);
        obstacles.push(playerBounds);
        const next = clipMovingBox(location, target, halfSize, obstacles);
        if (!held && next[1] > target[1]) carryable.fallSpeed = 0;
        const offset = vec3.subtract(vec3.create(), next, location);
        if (vec3.squaredLength(offset) === 0) continue;
        collider.location = next;
        const parent = entity.parent?.getComponent(Transform);
        if (parent) {
            const inverse = mat4.invert(mat4.create(), parent.worldMatrix);
            if (inverse) vec3.transformMat3(offset, offset, mat3.fromMat4(mat3.create(), inverse));
        }
        cube.location = vec3.add(vec3.create(), cube.location, offset);
    }
    return hint;
}
