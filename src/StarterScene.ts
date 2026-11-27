import { mat4, quat, vec3 } from "gl-matrix";
import { BoxCollider } from "./components/BoxCollider.ts";
import { Carryable } from "./components/Carryable.ts";
import { Camera } from "./components/Camera.ts";
import { Mesh } from "./components/Mesh.ts";
import { Transform, TransformType } from "./components/Transform.ts";
import { Entity } from "./Entity.ts";
import { GLTFParser } from "./parsers/GLTFParser.ts";
import type { Scene } from "./Scene.ts";
import { playerEyeHeight } from "./systems/GameSystem.ts";
import { computeTransforms } from "./systems/TransformSystem.ts";

type Point = [number, number, number];
type Bounds = [min: Point, max: Point];

function getMeshBounds(mesh: Mesh): Bounds | undefined {
    const min: Point = [Infinity, Infinity, Infinity];
    const max: Point = [-Infinity, -Infinity, -Infinity];
    // Each vertex stores position, normal, UV, and tangent in 11 floats.
    const vertexStride = 11;
    for (const primitives of mesh.primitives.values()) {
        for (const { vertices } of primitives) {
            for (let offset = 0; offset < vertices.length; offset += vertexStride) {
                for (let axis = 0; axis < 3; axis++) {
                    min[axis] = Math.min(min[axis], vertices[offset + axis]);
                    max[axis] = Math.max(max[axis], vertices[offset + axis]);
                }
            }
        }
    }
    if (min.every(Number.isFinite) && max.every(Number.isFinite)) return [min, max];
}

function addMapBox(scene: Scene, name: string, meshTransform: Transform, [min, max]: Bounds) {
    // Imported meshes can be nested under positioned and rotated asset roots.
    const worldPosition = mat4.getTranslation(vec3.create(), meshTransform.worldMatrix);
    const worldRotation = mat4.getRotation(quat.create(), meshTransform.worldMatrix);
    const worldScale = mat4.getScaling(vec3.create(), meshTransform.worldMatrix);
    const center = vec3.lerp([0, 0, 0], min, max, 0.5);
    vec3.multiply(center, center, worldScale);
    vec3.transformQuat(center, center, worldRotation);

    const halfSize = vec3.subtract([0, 0, 0], max, min);
    vec3.scale(halfSize, halfSize, 0.5);
    const transform = new Transform(TransformType.Free);
    transform.location = vec3.add(center, center, worldPosition);
    transform.rotation = worldRotation;
    transform.scale = vec3.multiply(halfSize, halfSize, worldScale);

    const collider = new Entity();
    collider.name = name;
    collider.addComponent(transform);
    collider.addComponent(new BoxCollider());
    scene.addEntity(collider);
    return transform;
}

function addMapColliders(scene: Scene) {
    for (const entity of scene.getEntitiesByComponent(Mesh)) {
        const mesh = entity.getComponent(Mesh)!;
        const meshTransform = entity.getComponent(Transform);
        const bounds = getMeshBounds(mesh);
        if (!meshTransform || !bounds) continue;

        const collider = addMapBox(scene, `${entity.name} collider`, meshTransform, bounds);
        const carryable = entity.getComponent(Carryable);
        if (carryable) carryable.collider = collider;
    }
}

export async function createStarterScene() {
    const response = await fetch("data/map_new/map.glb");
    if (!response.ok) {
        throw Error(`Could not load map: ${response.status} ${response.statusText}`);
    }
    const parser = new GLTFParser();
    await parser.setBinary(new Uint8Array(await response.arrayBuffer()));
    const scene = await parser.parseScene(parser.data.scene ?? 0);
    if (!scene) {
        throw Error("The exported map does not contain a playable scene.");
    }
    computeTransforms(scene);
    addMapColliders(scene);

    const spawn = scene.getEntityByName("R01_PlayerSpawn")?.getComponent(Transform);
    if (!spawn) throw Error("The map is missing its R01_PlayerSpawn marker.");
    const spawnPosition = mat4.getTranslation(vec3.create(), spawn.worldMatrix);
    spawnPosition[1] += playerEyeHeight;
    const camera = new Entity();
    camera.name = "PlayerCamera";
    const cameraTransform = new Transform(TransformType.LookAt);
    cameraTransform.location = spawnPosition;
    cameraTransform.target = vec3.add(vec3.create(), spawnPosition, [0, 0, -1]);
    cameraTransform.up = [0, 1, 0];
    camera.addComponent(cameraTransform);
    camera.addComponent(new Camera(1, Math.PI / 3, 0.1, 100));
    scene.addEntity(camera);

    return scene;
}
