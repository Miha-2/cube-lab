import { vec4 } from "gl-matrix";

/**
 * The structure that defines how mesh
 * surface is rendered.
 */
export abstract class Material {
    uniformBuffer: GPUBuffer | null = null;
}


/**
 * A textured material for basic mesh rendering.
 */
export class BasicMaterial extends Material {
    baseTexture: ImageBitmap;
    baseColor: vec4 = vec4.fromValues(0, 0, 0, 1);

    constructor(baseTexture: ImageBitmap, baseColor: vec4) {
        super();
        this.baseTexture = baseTexture;
        this.baseColor = baseColor;
    }
}
