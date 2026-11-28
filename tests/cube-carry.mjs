import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { vec3, quat } from 'gl-matrix';

// The importer uses browser image/event APIs even for solid-color materials.
globalThis.window = { addEventListener() {} };
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.createImageBitmap = async image => image;
const { Scene } = await import('../dist/Scene.js');
const { Entity } = await import('../dist/Entity.js');
const { Transform, TransformType } = await import('../dist/components/Transform.js');
const { BoxCollider } = await import('../dist/components/BoxCollider.js');
const { Carryable } = await import('../dist/components/Carryable.js');
const { GLTFParser } = await import('../dist/parsers/GLTFParser.js');
const { computeTransforms } = await import('../dist/systems/TransformSystem.js');
const { updateCubeCarry, getCubeInteractionTarget, getHeldCubeCollider } = await import('../dist/systems/CubeCarrySystem.js');
const { getPlayerBoxContacts, resolvePlayerBoxMovement } = await import('../dist/systems/BoxCollisionSystem.js');

const bytes = new Uint8Array(await readFile(new URL('../data/map/map.glb', import.meta.url)));
const parser = new GLTFParser();
await parser.setBinary(bytes);
const cubeNode = parser.data.nodes.find(node => ['R01_PuzzleCube', 'R01_Cube_01', 'CUBE'].includes(node.name));
assert(cubeNode, 'Expected the map cube');
// Test the next export's property without modifying the user's current GLB.
cubeNode.name = 'NameDoesNotControlPickup';
cubeNode.extras = { ...cubeNode.extras, game_type: 'cube' };
let scene = await parser.parseScene(parser.data.scene ?? 0);
assert.equal(scene.getEntitiesByComponent(Carryable).length, 1);
assert(scene.getEntityByName('NameDoesNotControlPickup').getComponent(Carryable));
// Exercise the real map loader and its direct entity-to-collider association.
// Add a collision proxy to old exports, without changing the file on disk.
const proxyName = 'Test_Cube_CollisionProxy';
const proxyIndex = parser.data.nodes.length;
parser.data.nodes.push({ name: proxyName, scale: [.5, .5, .5], extras: { collision_type: 'box' } });
cubeNode.children = [...(cubeNode.children ?? []), proxyIndex];
const oldJsonLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
const json = new TextEncoder().encode(JSON.stringify(parser.data));
const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(32); padded.set(json);
const binaryTail = bytes.slice(20 + oldJsonLength);
const taggedGlb = new Uint8Array(20 + padded.length + binaryTail.length);
taggedGlb.set(bytes.slice(0, 20)); taggedGlb.set(padded, 20); taggedGlb.set(binaryTail, 20 + padded.length);
const header = new DataView(taggedGlb.buffer); header.setUint32(8, taggedGlb.length, true); header.setUint32(12, padded.length, true);
globalThis.fetch = async () => new Response(taggedGlb);
const { createStarterScene } = await import('../dist/StarterScene.js');
const imported = await createStarterScene();
const importedCube = imported.getEntityByName('NameDoesNotControlPickup');
assert.equal(importedCube.getComponent(Carryable).collider,
    imported.getEntityByName(`${proxyName} physics`).getComponent(Transform));
const plain = new GLTFParser();
await plain.setJson(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ name: 'CUBE' }] }), './');
assert.equal((await plain.parseScene(0)).getEntitiesByComponent(Carryable).length, 0);

function box(scene, name, position, scale = [.5, .5, .5]) {
    const entity = new Entity(); entity.name = name;
    const transform = new Transform(TransformType.Free);
    transform.location = [...position]; transform.scale = [...scale];
    entity.addComponent(transform); entity.addComponent(new BoxCollider()); scene.addEntity(entity);
    return transform;
}
function cube(scene, name, position) {
    const entity = new Entity(); entity.name = name;
    const transform = new Transform(TransformType.Free); transform.location = [...position];
    const carryable = new Carryable(); carryable.collider = box(scene, `${name} physics`, position);
    entity.addComponent(transform); entity.addComponent(carryable); scene.addEntity(entity);
    return { entity, transform, carryable };
}
const camera = new Transform(TransformType.LookAt);
camera.location = [0, 1.7, 0]; camera.target = [0, 1.7, -1];
const player = { min: [-.3, 0, -.3], max: [.3, 1.8, .3] };
scene = new Scene();
const near = cube(scene, 'Any name', [0, 1.7, -2]);
const far = cube(scene, 'Another name', [0, 1.7, -3]);
assert.equal(updateCubeCarry(scene, camera, player, false, 0), 'pickup');
assert.equal(getCubeInteractionTarget(scene), near.carryable.collider);
assert.equal(updateCubeCarry(scene, camera, player, true, .016), 'drop');
assert.equal(getCubeInteractionTarget(scene), near.carryable.collider);
assert.equal(getHeldCubeCollider(scene), near.carryable.collider);
assert.equal(far.transform.location[2], -3, 'Only the held cube should follow the camera');
const [cubeX, cubeY, cubeZ] = near.carryable.collider.location;
const aboveHeld = [cubeX, cubeY + 0.5 + 1.7, cubeZ];
const boxes = getPlayerBoxContacts(scene, aboveHeld, 1.7, .3, .1, getHeldCubeCollider(scene));
assert.equal(resolvePlayerBoxMovement(boxes, aboveHeld, [...aboveHeld]).groundEyeY, -Infinity,
    'The held cube must not support the player');
updateCubeCarry(scene, camera, player, true, 0);
assert.equal(getHeldCubeCollider(scene), undefined);
const blocker = box(scene, 'Wall', [0, 1.7, -1], [.5, 1, .1]);
assert.equal(updateCubeCarry(scene, camera, player, false, 0), undefined, 'Cannot pick through a wall');
blocker.location = [10, 1.7, -1];
camera.location = [2, 1.7, 0]; camera.target = [2, 1.7, -1];
const other = cube(scene, 'Third cube', [2, 1.7, -2]);
assert.equal(updateCubeCarry(scene, camera, player, false, 0), 'pickup');
assert.equal(getCubeInteractionTarget(scene), other.carryable.collider, 'Prompt follows the targeted cube');

scene = new Scene();
const a = cube(scene, 'Falling A', [5, 4, 0]);
const b = cube(scene, 'Falling B', [8, 6, 0]);
box(scene, 'Floor', [0, -.1, 0], [20, .1, 20]);
updateCubeCarry(scene, camera, player, false, .1);
assert(Math.abs(a.transform.location[1] - 3.95095) < 1e-5);
assert(Math.abs(b.transform.location[1] - 5.95095) < 1e-5);

scene = new Scene();
const parent = new Entity(); const parentTransform = new Transform(TransformType.Free);
parentTransform.location = [5, 0, 0]; parentTransform.rotation = quat.setAxisAngle(quat.create(), [0, 1, 0], Math.PI / 2);
parent.addComponent(parentTransform); scene.addEntity(parent);
const nested = cube(scene, 'Nested cube', [5, 4, 0]); nested.entity.parent = parent; nested.transform.location = [0, 4, 0];
computeTransforms(scene);
camera.location = [5, 4, 2]; camera.target = [5, 4, 0];
updateCubeCarry(scene, camera, { min: [4.7, 2.3, 1.7], max: [5.3, 4.1, 2.3] }, true, .016);
computeTransforms(scene);
const world = vec3.transformMat4(vec3.create(), [0, 0, 0], nested.transform.worldMatrix);
assert(vec3.distance(world, nested.carryable.collider.location) < 1e-5, 'Parented cube remains aligned with its collider');
console.log('Passed: property import, name independence, nearest selection, occlusion, pickup/drop, per-cube prompt, independent gravity, parented transforms.');
