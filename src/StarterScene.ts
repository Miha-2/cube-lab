import { vec3 } from "gl-matrix";
import { BoxCollider } from "./components/BoxCollider.ts";
import { Camera } from "./components/Camera.ts";
import { Light, LightType } from "./components/Light.ts";
import { Mesh } from "./components/Mesh.ts";
import { Transform, TransformType } from "./components/Transform.ts";
import { Entity } from "./Entity.ts";
import { GLTFParser } from "./parsers/GLTFParser.ts";
import type { Scene } from "./Scene.ts";
import { playerEyeHeight } from "./systems/GameSystem.ts";

// Every map mesh contains a unit box. These meshes also contain a second box.
const extraBoxBounds: Record<string, [min: vec3, max: vec3]> = {
    "Cube.010": [[-0.91507, -1, 0.96028], [99.78076, 1, 1]],
    "Cube.011": [[-1.00151, -1, -223.35733], [-0.92864, 1, 1.00688]],
    "wall obstacle": [[-0.80448, -11.47636, -0.99023], [0.80448, -0.53045, 0.99023]],
    "wall obstacle.001": [[-0.80448, -11.47636, -0.99023], [0.80448, -0.53045, 0.99023]],
};

function addMapColliders(scene: Scene) {
    for (const entity of scene.getEntitiesByComponent(Mesh)) {
        const meshTransform = entity.getComponent(Transform)!;
        entity.addComponent(new BoxCollider());

        const bounds = extraBoxBounds[entity.name ?? ""];
        if (!bounds) continue;

        const [min, max] = bounds;
        const center = vec3.scale([0, 0, 0], vec3.add([0, 0, 0], min, max), 0.5);
        vec3.multiply(center, center, meshTransform.scale);
        vec3.transformQuat(center, center, meshTransform.rotation);

        const halfSize = vec3.scale([0, 0, 0], vec3.subtract([0, 0, 0], max, min), 0.5);
        const transform = new Transform(TransformType.Free);
        transform.location = vec3.add(center, center, meshTransform.location);
        transform.rotation = meshTransform.rotation;
        transform.scale = vec3.multiply(halfSize, halfSize, meshTransform.scale);

        // Separate colliders leave the empty space between mesh parts traversable.
        const collider = new Entity();
        collider.name = `${entity.name} collider`;
        collider.addComponent(transform);
        collider.addComponent(new BoxCollider());
        scene.addEntity(collider);
    }
}

export async function createStarterScene() {
    const response = await fetch("data/map/mapa.gltf");
    if (!response.ok) {
        throw Error(`Could not load map: ${response.status} ${response.statusText}`);
    }
    const parser = new GLTFParser();
    await parser.setJson(await response.text(), "data/map/");
    const scene = await parser.parseScene(parser.data.scene ?? 0);
    if (!scene) {
        throw Error("The exported map does not contain a playable scene.");
    }
    addMapColliders(scene);

    const floor = scene.getEntityByName("Cube")?.getComponent(Transform);
    if (!floor) throw Error("The map is missing its floor.");
    const spawnY = floor.location[1] + Math.abs(floor.scale[1]) + playerEyeHeight;
    const camera = new Entity();
    camera.name = "PlayerCamera";
    const cameraTransform = new Transform(TransformType.LookAt);
    cameraTransform.location = [-6, spawnY, 0];
    cameraTransform.target = [0, spawnY, 0];
    cameraTransform.up = [0, 1, 0];
    camera.addComponent(cameraTransform);
    camera.addComponent(new Camera(1, Math.PI / 3, 0.1, 100));
    scene.addEntity(camera);

    const lightEntity = new Entity();
    lightEntity.name = "PointLight";
    const lightTransform = new Transform(TransformType.Free);
    lightTransform.location = [2, 3, 3];
    const light = new Light(LightType.Point);
    light.intensity = 12;
    lightEntity.addComponent(lightTransform);
    lightEntity.addComponent(light);
    scene.addEntity(lightEntity);

    return scene;
}
