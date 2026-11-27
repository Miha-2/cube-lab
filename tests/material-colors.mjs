// Run with: node tests/material-colors.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false } });
try {
    globalThis.ImageData = class {
        constructor(data) { this.data = data; }
    };
    globalThis.createImageBitmap = async image => image;
    const { GLTFParser } = await server.ssrLoadModule('/src/parsers/GLTFParser.ts');
    const parser = new GLTFParser();
    const factor = [0.05, 0.3, 0.8, 1];
    await parser.setJson(JSON.stringify({ materials: [
        { pbrMetallicRoughness: { baseColorFactor: factor } },
        { pbrMetallicRoughness: {} },
        { pbrMetallicRoughness: { baseColorFactor: factor, baseColorTexture: { index: 0 } } },
        { emissiveFactor: [0.1, 0.5, 1], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } } },
        { emissiveFactor: [1, 0.25, 0] },
    ] }), '');
    const plain = await parser.parseMaterial(0);
    assert.deepEqual([...plain.baseTexture.data], [255, 255, 255, 255], 'Factor must not also be baked into the texture');
    factor.forEach((value, i) => assert.ok(Math.abs(plain.baseColor[i] - value) < 0.000001));
    const defaultMaterial = await parser.parseMaterial(1);
    assert.deepEqual([...defaultMaterial.baseTexture.data], [255, 255, 255, 255]);
    assert.deepEqual([...defaultMaterial.baseColor], [1, 1, 1, 1]);
    assert.deepEqual([...defaultMaterial.emission], [0, 0, 0, 0]);
    const glowing = await parser.parseMaterial(3);
    [0.2, 1, 2, 0].forEach((value, i) => assert.ok(Math.abs(glowing.emission[i] - value) < 0.000001));
    assert.deepEqual([...(await parser.parseMaterial(4)).emission], [1, 0.25, 0, 0]);
    const texture = { name: 'image texture' };
    parser.parseTexture = async () => texture;
    const textured = await parser.parseMaterial(2);
    assert.equal(textured.baseTexture, texture);
    factor.forEach((value, i) => assert.ok(Math.abs(textured.baseColor[i] - value) < 0.000001));
    console.log('PASS: material factors, white defaults, textured factors, emission color and emission strength.');
} finally {
    await server.close();
}
