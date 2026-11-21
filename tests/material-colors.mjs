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
    ] }), '');
    const plain = await parser.parseMaterial(0);
    assert.deepEqual([...plain.baseTexture.data], [255, 255, 255, 255], 'Factor must not also be baked into the texture');
    factor.forEach((value, i) => assert.ok(Math.abs(plain.baseColor[i] - value) < 0.000001));
    const defaultMaterial = await parser.parseMaterial(1);
    assert.deepEqual([...defaultMaterial.baseTexture.data], [255, 255, 255, 255]);
    assert.deepEqual([...defaultMaterial.baseColor], [1, 1, 1, 1]);
    const texture = { name: 'image texture' };
    parser.parseTexture = async () => texture;
    const textured = await parser.parseMaterial(2);
    assert.equal(textured.baseTexture, texture);
    factor.forEach((value, i) => assert.ok(Math.abs(textured.baseColor[i] - value) < 0.000001));
    console.log('PASS: material factors, white defaults, and textured material factors.');
} finally {
    await server.close();
}
