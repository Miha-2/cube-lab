import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
globalThis.window = { addEventListener() {} };
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.createImageBitmap = async image => image;
const { GLTFParser } = await import('../dist/parsers/GLTFParser.js');
const { Mesh } = await import('../dist/components/Mesh.js');
const { BasicMaterial } = await import('../dist/data/Material.js');
const { SignalState } = await import('../dist/components/SignalState.js');
const { SignalIndicator } = await import('../dist/components/SignalIndicator.js');
const { setSignalActive, updateSignalIndicators } = await import('../dist/systems/SignalSystem.js');
const { updateBuffers } = await import('../dist/systems/BufferUpdateSystem.js');
const { Scene } = await import('../dist/Scene.js');
const { Entity } = await import('../dist/Entity.js');
async function load(path) {
 const parser = new GLTFParser(); await parser.setBinary(new Uint8Array(await readFile(path)));
 return { parser, scene: await parser.parseScene(parser.data.scene ?? 0) };
}
const materials = entity => (entity.getComponent(Mesh)?.getPrimitivesByMaterial(BasicMaterial) ?? []).map(p => p.material);
const snapshot = entity => materials(entity).map(m => [...m.baseColor, ...m.emission]);
const map = await load(new URL('../data/map/map.glb', import.meta.url));
const { scene } = map;
assert.equal(scene.getEntitiesByComponent(SignalState).length, 13);
assert.equal(scene.getEntitiesByComponent(SignalIndicator).length, 11);
updateSignalIndicators(scene);
const plate = scene.getEntityByName('R01_PressurePlate__PressurePlate_Outline');
const plateDoor = scene.getEntityByName('R01_Door01_ToLeverRoom__Door_Outline');
const leverStatus = scene.getEntityByName('R01_FreestandingLever__FreestandingLever_Status');
const cable = scene.getEntityByName('R01_PlateCable_Endpoint__Cable_End_Emissive');
const leverCable = scene.getEntityByName('R01_LeverCable_Endpoint__Cable_End_Emissive');
assert.notEqual(materials(cable)[0], materials(leverCable)[0]);
const leverOff = snapshot(leverStatus), grey = snapshot(plate);
const staticEntities = scene.getEntitiesByComponent(Mesh).filter(e => !e.getComponent(SignalIndicator));
const before = staticEntities.map(snapshot);
setSignalActive(scene, 'R01_PressurePlate', true);
for (const entity of [plate, cable]) {
 const m = materials(entity)[0]; assert.equal(m.baseColor[1], 1); assert.equal(m.emission[1], 2);
}
assert.deepEqual(snapshot(leverStatus), leverOff, 'Other circuit stays inactive');
setSignalActive(scene, 'R01_PressurePlate', false);
assert.deepEqual(snapshot(plate), grey, 'Switching off restores non-emissive grey');
assert.deepEqual([...materials(plate)[0].emission], [0, 0, 0, 0]);
assert(materials(plate)[0].baseColor[0] > .45, 'Unpowered diffuser is lighter than the dark housing');
assert.deepEqual(staticEntities.map(snapshot), before, 'Bodies, cube lights and decorations stay untouched');
assert.throws(() => setSignalActive(scene, 'R01_Door01_ToLeverRoom', true), /follows/);
assert.throws(() => setSignalActive(scene, 'missing', true), /Unknown/);

// Simulate uploads without needing WebGPU: a changed indicator uploads once, then stays quiet.
const gpuScene = new Scene(), uploadEntity = new Entity();
const indicator = plate.getComponent(SignalIndicator);
uploadEntity.addComponent(plate.getComponent(Mesh)); uploadEntity.addComponent(indicator);gpuScene.addEntity(uploadEntity);
for (const material of materials(plate)) material.uniformBuffer = {};
let writes = 0; const gpu = { device: { queue: { writeBuffer() { writes++; } } } };
updateBuffers(gpu, gpuScene); assert.equal(writes, materials(plate).length * 2);
updateBuffers(gpu, gpuScene); assert.equal(writes, materials(plate).length * 2);
setSignalActive(scene, 'R01_PressurePlate', true);
updateBuffers(gpu, gpuScene); assert.equal(writes, materials(plate).length * 4);

// A future connection may follow a door's signal; reject broken references and loops clearly.
const doorState = scene.getEntityByName('R01_Door01_ToLeverRoom').getComponent(SignalState);
const cableState = scene.getEntityByName('R01_PlateCable_Endpoint').getComponent(SignalState);
cableState.source = doorState.id; updateSignalIndicators(scene); assert.equal(materials(cable)[0].emission[1], 2);
cableState.source = 'missing';assert.throws(() => updateSignalIndicators(scene), /missing signal_source/);
cableState.source = cableState.id;assert.throws(() => updateSignalIndicators(scene), /cycle/);
console.log('PASS: real-map state links, isolated materials, independent circuits, dim inactive color, state reversal, static materials, GPU uploads, chained links and invalid connections.');

if (process.argv[2]) {
 const assets = await load(process.argv[2]);updateSignalIndicators(assets.scene);
 const keypad = assets.scene.getEntityByName('Keypad_Status');
 const other = assets.scene.getEntityByName('Keypad4_Status');
 const laser = assets.scene.getEntityByName('LaserBeam');
 const ceiling = assets.scene.getEntityByName('Ceiling_Light_Emission');
 const laserBefore = snapshot(laser), ceilingBefore = snapshot(ceiling), otherBefore = snapshot(other);
 const decoration = ['Door_Outline', 'Door_Indicator_TopLeft', 'FreestandingLever_Cyan_Left', 'Keypad_Cyan_Left', 'Keypad_ScreenBorder'].map(n => assets.scene.getEntityByName(n));
 const decorationBefore = decoration.map(snapshot);
 assert(decoration.every(e => !e.getComponent(SignalIndicator)));
 assert.equal(materials(keypad)[0].baseColor[0], 1);assert.equal(materials(keypad)[0].baseColor[1], 0);
 setSignalActive(assets.scene, 'keypad_2digit_01', true);
 assert.equal(materials(keypad)[0].emission[1], 2);
 assert.deepEqual(snapshot(other), otherBefore, 'Other keypad stays red');
 assert.deepEqual(snapshot(laser), laserBefore, 'Laser retains its original red materials');
 assert.deepEqual(snapshot(ceiling), ceilingBefore, 'Ceiling stays cyan');
 setSignalActive(assets.scene, 'lever_01', true);
 setSignalActive(assets.scene, 'door_01', true);
 assert.deepEqual(decoration.map(snapshot), decorationBefore, 'Decorative blue and warm lights never change');
 setSignalActive(assets.scene, 'keypad_2digit_01', false);assert.equal(materials(keypad)[0].baseColor[1], 0);
 console.log('PASS: actual asset export preserves tags, independent keypads, red inactive indicators, red laser, cyan ceiling and original decorative lights.');
}
