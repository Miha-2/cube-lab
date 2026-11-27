import { vec3 } from "gl-matrix";
import { BoxCollider } from "./components/BoxCollider.ts";
import { Camera } from "./components/Camera.ts";
import { Mesh } from "./components/Mesh.ts";
import { Transform, TransformType } from "./components/Transform.ts";
import { Entity } from "./Entity.ts";
import { GLTFParser } from "./parsers/GLTFParser.ts";
import type { Scene } from "./Scene.ts";
import { playerEyeHeight } from "./systems/GameSystem.ts";

type Point = [number, number, number];
type Bounds = [min: Point, max: Point];
const unitBoxBounds: Bounds = [[-1, -1, -1], [1, 1, 1]];

// These meshes in the first map export contain two separate boxes.
const legacyExtraBoxBounds = new Map<string, Bounds>([
    ["Cube.010", [[-0.91507, -1, 0.96028], [99.78076, 1, 1]]],
    ["Cube.011", [[-1.00151, -1, -223.35733], [-0.92864, 1, 1.00688]]],
    ["wall obstacle", [[-0.80448, -11.47636, -0.99023], [0.80448, -0.53045, 0.99023]]],
    ["wall obstacle.001", [[-0.80448, -11.47636, -0.99023], [0.80448, -0.53045, 0.99023]]],
]);

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
    const center = vec3.lerp([0, 0, 0], min, max, 0.5);
    vec3.multiply(center, center, meshTransform.scale);
    vec3.transformQuat(center, center, meshTransform.rotation);

    const halfSize = vec3.subtract([0, 0, 0], max, min);
    vec3.scale(halfSize, halfSize, 0.5);
    const transform = new Transform(TransformType.Free);
    transform.location = vec3.add(center, center, meshTransform.location);
    transform.rotation = meshTransform.rotation;
    transform.scale = vec3.multiply(halfSize, halfSize, meshTransform.scale);

    const collider = new Entity();
    collider.name = name;
    collider.addComponent(transform);
    collider.addComponent(new BoxCollider());
    scene.addEntity(collider);
}

function addMapColliders(scene: Scene) {
    for (const entity of scene.getEntitiesByComponent(Mesh)) {
        const mesh = entity.getComponent(Mesh)!;
        const meshTransform = entity.getComponent(Transform);
        const bounds = getMeshBounds(mesh);
        if (!meshTransform || !bounds) continue;

        const [min, max] = bounds;
        const extra = legacyExtraBoxBounds.get(entity.name ?? "");
        const matchesLegacyMesh = extra && min.every((value, axis) =>
            Math.abs(value - Math.min(-1, extra[0][axis])) < 0.0001 &&
            Math.abs(max[axis] - Math.max(1, extra[1][axis])) < 0.0001);
        if (matchesLegacyMesh) {
            // Separate boxes leave the gap between the original mesh parts traversable.
            addMapBox(scene, `${entity.name} collider`, meshTransform, unitBoxBounds);
            addMapBox(scene, `${entity.name} extra collider`, meshTransform, extra);
        } else {
            addMapBox(scene, `${entity.name} collider`, meshTransform, bounds);
        }
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

    const floorCollider = scene.getEntityByName("Cube collider")?.getComponent(Transform);
    if (!floorCollider) throw Error("The map is missing its floor collider.");
    const spawnY = floorCollider.location[1] + Math.abs(floorCollider.scale[1]) + playerEyeHeight;
    const camera = new Entity();
    camera.name = "PlayerCamera";
    const cameraTransform = new Transform(TransformType.LookAt);
    cameraTransform.location = [0, spawnY, 0];
    cameraTransform.target = [6, spawnY, 0];
    cameraTransform.up = [0, 1, 0];
    camera.addComponent(cameraTransform);
    camera.addComponent(new Camera(1, Math.PI / 3, 0.1, 100));
    scene.addEntity(camera);

    return scene;
}
