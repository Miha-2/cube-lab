import { mat4, vec3 } from "gl-matrix";
import { BoxCollider } from "./components/BoxCollider.ts";
import { Carryable } from "./components/Carryable.ts";
import { Camera } from "./components/Camera.ts";
import { Transform, TransformType } from "./components/Transform.ts";
import { Entity } from "./Entity.ts";
import { GLTFParser } from "./parsers/GLTFParser.ts";
import type { Scene } from "./Scene.ts";
import { playerEyeHeight } from "./systems/GameSystem.ts";
import { computeTransforms } from "./systems/TransformSystem.ts";
import { syncBoxColliders } from "./systems/BoxCollisionSystem.ts";

function addMapColliders(scene: Scene) {
    const proxies = scene.getEntitiesByComponent(BoxCollider);
    if (proxies.length === 0) {
        throw Error("The map has no collision boxes. Re-export map.blend with Custom Properties enabled.");
    }
    for (const proxy of proxies) {
        const box = proxy.getComponent(BoxCollider)!;
        box.source = proxy.getComponent(Transform)!;
        proxy.removeComponent(BoxCollider);
        const collider = new Entity();
        collider.name = `${proxy.name} physics`;
        const transform = new Transform(TransformType.Free);
        collider.addComponent(transform);
        collider.addComponent(box);
        scene.addEntity(collider);
        // A collision proxy follows the visual part it is parented to in Blender.
        for (let owner = proxy.parent; owner; owner = owner.parent) {
            const carryable = owner.getComponent(Carryable);
            if (carryable) {
                carryable.collider = transform;
                break;
            }
        }
    }
    syncBoxColliders(scene);
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
