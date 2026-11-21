import { Camera } from "./components/Camera.ts";
import { Transform, TransformType } from "./components/Transform.ts";
import { Entity } from "./Entity.ts";
import { GLTFParser } from "./parsers/GLTFParser.ts";

// glTF converts Blender Z-up to Y-up. This export has its floor surface at Y ≈ 0.39.
export async function createStarterScene() {
    const response = await fetch("data/map/mapa.gltf");
    if (!response.ok) {
        throw Error(`Could not load map: ${response.status} ${response.statusText}`);
    }
    const parser = new GLTFParser();
    await parser.setJson(await response.text(), "data/map/");
    const scene = await parser.parseScene(0);
    if (!scene) {
        throw Error("The exported map does not contain scene 0.");
    }

    const camera = new Entity();
    camera.name = "PlayerCamera";
    const cameraTransform = new Transform(TransformType.LookAt);
    // Elevated preview from the open side, looking slightly downward.
    cameraTransform.location = [-23, 8, 0];
    cameraTransform.target = [5, 2.1, 0];
    cameraTransform.up = [0, 1, 0];
    camera.addComponent(cameraTransform);
    camera.addComponent(new Camera(1, Math.PI / 3, 0.1, 100));
    scene.addEntity(camera);

    return scene;
}
