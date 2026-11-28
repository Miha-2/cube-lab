import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
globalThis.window = { addEventListener() {} };
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.createImageBitmap = async image => image;
const { Scene } = await import('../dist/Scene.js');
const { Entity } = await import('../dist/Entity.js');
const { Transform, TransformType } = await import('../dist/components/Transform.js');
const { BoxCollider } = await import('../dist/components/BoxCollider.js');
const { Mesh } = await import('../dist/components/Mesh.js');
const { Carryable } = await import('../dist/components/Carryable.js');
const { computeTransforms } = await import('../dist/systems/TransformSystem.js');
const { getPlayerBoxContacts, resolvePlayerBoxMovement, tryPlayerStep, syncBoxColliders } = await import('../dist/systems/BoxCollisionSystem.js');
function box(scene, center, half) {
 const entity = new Entity(); const transform = new Transform(TransformType.Free);
 transform.location = center; transform.scale = half; entity.addComponent(transform); entity.addComponent(new BoxCollider()); scene.addEntity(entity);
}
function room(height, ceiling = false, wall = false) {
 const scene = new Scene(); box(scene, [0, -.05, 0], [5, .05, 5]);
 box(scene, [0, height / 2, 0], [.8, height / 2, .8]);
 if (ceiling) box(scene, [0, 1.9, 0], [5, .05, 5]);
 if (wall) box(scene, [.2, 1.5, 0], [.1, 1.5, 2]);
 return scene;
}
function move(scene, location, desired, step = .12) {
 const contacts = getPlayerBoxContacts(scene, location, 1.7, .3, .1);
 const next = [...desired]; let surfaces = resolvePlayerBoxMovement(contacts, location, next);
 if (step > 0 && (next[0] !== desired[0] || next[2] !== desired[2])) {
  const stepped = tryPlayerStep(contacts, location, desired, step, Math.PI / 6 + 1e-6);
  if (stepped) {
   next.splice(0, 3, ...stepped);
   surfaces = resolvePlayerBoxMovement(getPlayerBoxContacts(scene, next, 1.7, .3, .1), next, next);
  }
 }
 return { next, ...surfaces };
}
for (const height of [.04, .08, .12]) {
 const result = move(room(height), [-1.2, 1.7, 0], [-1.0, 1.7, 0]);
 assert(Math.abs(result.next[0] + 1) < 1e-6, `Should walk onto ${height} m obstacle`);
 assert(Math.abs(result.groundEyeY - (1.7 + height)) < 1e-6);
 assert(result.followsSurface);
}
assert(move(room(.16), [-1.2, 1.7, 0], [-1, 1.7, 0]).next[0] < -1.09, 'Tall obstacles block');
assert(move(room(.08, true), [-1.2, 1.7, 0], [-1, 1.7, 0]).next[0] < -1.09, 'Low ceilings prevent stepping');
assert(move(room(.08), [-1.2, 1.7, 0], [-1, 1.7, 0], 0).next[0] < -1.09, 'No stepping when disabled/airborne');
const crossed = move(room(.08, false, true), [-1.2, 1.7, 0], [.5, 1.7, 0]);
assert(crossed.next[0] < .1, 'Stepping must not bypass a wall');
if (process.argv[2]) {
 const bytes = await readFile(process.argv[2]); globalThis.fetch = async () => new Response(bytes);
 const { createStarterScene } = await import('../dist/StarterScene.js'); const scene = await createStarterScene();
 assert.equal(scene.getEntitiesByComponent(BoxCollider).length, 49);
 assert(!scene.getEntitiesByComponent(Mesh).some(entity => entity.name.startsWith('COL_')), 'Collision helpers are invisible');
 assert(scene.getEntitiesByComponent(Carryable)[0].getComponent(Carryable).collider, 'Cube linked to explicit collider');
 for (const entity of scene.getEntitiesByComponent(BoxCollider)) {
  const transform = entity.getComponent(Transform);
  assert(Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-5, `Unit rotation: ${entity.name}`);
 }
 // The shared wall is rotated 90 degrees and contains scaled half-length modules.
 // Test both directions, including seams; testing only the door center missed this bug.
 for (const z of [-.5, -1, -2, -2.5, -5.5, -6, -7, -7.7]) {
  assert(move(scene, [7, 1.7, z], [9, 1.7, z]).next[0] < 8, `Shared wall blocks eastbound at ${z}`);
  assert(move(scene, [9, 1.7, z], [7, 1.7, z]).next[0] > 8, `Shared wall blocks westbound at ${z}`);
 }
 for (const [start, end, axis, boundary, sign] of [
  [[11, 1.7, -4], [13, 1.7, -4], 0, 12, 1],
  [[1, 1.7, -4], [-1, 1.7, -4], 0, 0, -1],
  [[4, 1.7, -7], [4, 1.7, -9], 2, -8, -1],
  [[4, 1.7, -1], [4, 1.7, 1], 2, 0, 1],
 ]) assert(sign * (move(scene, start, end).next[axis] - boundary) < 0, 'Outer wall blocks passage');
 const start = [7.2, 1.7, -4], end = [8.7, 1.7, -4];
 assert(move(scene, start, end, 0).next[0] < 8, 'Closed door blocks passage');
 for (const name of ['R01_Door01_ToLeverRoom__Door_Left', 'R01_Door01_ToLeverRoom__Door_Right']) {
  const transform = scene.getEntityByName(name).getComponent(Transform); transform.location = [Math.sign(transform.location[0]) * 1.524, transform.location[1], transform.location[2]];
 }
 computeTransforms(scene); syncBoxColliders(scene);
 assert(Math.abs(move(scene, start, end, 0).next[0] - end[0]) < 1e-5, 'Open doorway has no frame collider across opening');
 // Walk onto the 4 cm base before the button, which is another 12 cm higher.
 const base = move(scene, [3.5, 1.7, -1.8], [3.7, 1.7, -1.8]);
 assert(Math.abs(base.next[0] - 3.7) < 1e-5, 'Pressure plate base is walkable');
 const plate = move(scene, base.next, [3.9, base.next[1], -1.8]);
 assert(Math.abs(plate.next[0] - 3.9) < 1e-5, 'Real pressure plate is walkable');
 const button = scene.getEntityByName('R01_PressurePlate__PressurePlate_Button').getComponent(Transform);
 button.location = [button.location[0], 0, button.location[2]]; computeTransforms(scene); syncBoxColliders(scene);
 const physics = scene.getEntityByName('COL_PressurePlate_Button physics').getComponent(Transform);
 assert(Math.abs(physics.location[1] - .06) < 1e-5, 'Button collider follows depression');
 console.log('Passed real-map import: 49 explicit boxes, no helper meshes rendered, cube association, door opening, pressure plate stepping and moving proxy synchronization.');
}
console.log('Passed auto-step: 4/8/12 cm steps, tall obstacles, headroom, disabled stepping and wall rejection.');
