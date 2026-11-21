import { Camera } from "./components/Camera.ts";
import { Light, LightType } from "./components/Light.ts";
import { Mesh } from "./components/Mesh.ts";
import { Transform, TransformType } from "./components/Transform.ts";
import { BasicMaterial } from "./data/Material.ts";
import { Entity } from "./Entity.ts";
import { Scene } from "./Scene.ts";
import { createCube } from "./Utils.ts";

// Y is up; one unit represents one metre. The floor surface is at Y = 0.
export async function createStarterScene() {
    const scene = new Scene();

    const floor = await createCube();
    floor.name = "Floor";
    const floorTransform = floor.getComponent(Transform)!;
    floorTransform.location = [0, -0.1, 0];
    floorTransform.scale = [10, 0.1, 10];

    const cube = await createCube();
    cube.name = "Cube";
    cube.getComponent(Transform)!.location = [0, 1, 0];

    for (const [entity, texturePath] of [
        [floor, "data/textures/woodenfloor3.jpg"],
        [cube, "data/textures/stonewall.jpg"],
    ] as const) {
        const response = await fetch(texturePath);
        if (!response.ok) {
            throw Error(`Could not load texture: ${texturePath}`);
        }
        const material = entity.getComponent(Mesh)!.getPrimitivesByMaterial(BasicMaterial)![0].material as BasicMaterial;
        material.baseTexture.close();
        material.baseTexture = await createImageBitmap(await response.blob());
        scene.addEntity(entity);
    }

    const camera = new Entity();
    camera.name = "PlayerCamera";
    const cameraTransform = new Transform(TransformType.LookAt);
    cameraTransform.location = [4, 1.7, 6];
    cameraTransform.target = [0, 1, 0];
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
