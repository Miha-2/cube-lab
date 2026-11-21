import { vec3 } from "gl-matrix";
import { Camera } from "../components/Camera.ts";
import { Transform } from "../components/Transform.ts";
import type { Entity } from "../Entity.ts";
import type { Scene } from "../Scene.ts";

const heldKeys = new Set<string>();

window.addEventListener("keydown", (event) => heldKeys.add(event.code));
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
window.addEventListener("blur", () => heldKeys.clear());

const cameraSpeed = 10;

/** Updates game logic once per frame. Delta time is in seconds. */
export function updateGame(scene: Scene, dt: number): void {

    const transform = scene.getEntityByName("PlayerCamera")?.getComponent(Transform);
    if (!transform) return;

    const dx = Number(heldKeys.has("KeyW")) - Number(heldKeys.has("KeyS"));
    const dy = Number(heldKeys.has("Space")) - Number(heldKeys.has("ShiftLeft"));
    const dz = Number(heldKeys.has("KeyA")) - Number(heldKeys.has("KeyD"));
    if (dx === 0 && dy === 0 && dz === 0) return;

    const [x, y, z] = transform.location;
    const step = cameraSpeed * dt;
    transform.location = [x + dx * step, y + dy * step, z + dz * step];

}
