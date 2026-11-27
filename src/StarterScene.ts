import { quat, type vec3 } from "gl-matrix";
import { BoxCollider } from "./components/BoxCollider.ts";
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
    floor.addComponent(new BoxCollider());

    const leftBoxPitch = Math.PI / 9;
    const leftBoxHeight = 0.55 * Math.cos(leftBoxPitch) + 0.7 * Math.sin(leftBoxPitch);
    const boxLayouts: { name: string; location: vec3; scale: vec3; yaw: number; pitch?: number }[] = [
        { name: "Cube", location: [0, 1, 0], scale: [1, 1, 1], yaw: 0 },
        { name: "LeftBox", location: [-4, leftBoxHeight, -1.5], scale: [1.2, 0.55, 0.7], yaw: Math.PI / 4, pitch: leftBoxPitch },
        { name: "RightBox", location: [3.5, 0.8, -3], scale: [0.8, 0.8, 1.2], yaw: -Math.PI / 6 },
    ];
    const texturedEntities: [Entity, string][] = [[floor, "data/textures/woodenfloor3.jpg"]];
    for (const { name, location, scale, yaw, pitch = 0 } of boxLayouts) {
        const box = await createCube();
        box.name = name;
        const transform = box.getComponent(Transform)!;
        transform.location = location;
        transform.scale = scale;
        const rotation = quat.setAxisAngle(quat.create(), [0, 1, 0], yaw);
        transform.rotation = quat.rotateX(rotation, rotation, pitch);
        box.addComponent(new BoxCollider());
        texturedEntities.push([box, "data/textures/stonewall.jpg"]);
    }

    for (const [entity, texturePath] of texturedEntities) {
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
