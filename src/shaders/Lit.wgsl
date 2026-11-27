struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec3f,
}

struct SkinnedVertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec3f,
    @location(4) joints: vec4u,
    @location(5) weights: vec4f
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPosition: vec3f,
    @location(2) worldNormal: vec3f,
}

struct Camera {
    view: mat4x4f,
    projection: mat4x4f
}

struct Model {
    matrix: mat4x4f,
    normalMatrix: mat4x4f,
}

struct PointLight {
    positionIntensity: vec4f,
    colorInvRangeSquared: vec4f,
}

struct Material {
    baseColorFactor: vec4f,
    emission: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> pointLights: array<PointLight>;
@group(1) @binding(0) var<uniform> model: Model;
@group(2) @binding(0) var<uniform> material: Material;
@group(2) @binding(1) var baseTexture: texture_2d<f32>;
@group(2) @binding(2) var textureSampler: sampler;
@group(3) @binding(0) var<storage, read> jointMatrices: array<mat4x4f>;

fn makeVertexOutput(localPosition: vec4f, localNormal: vec3f, uv: vec2f) -> VertexOutput {
    let worldPosition = model.matrix * localPosition;
    var output: VertexOutput;
    output.position = camera.projection * camera.view * worldPosition;
    output.uv = uv;
    output.worldPosition = worldPosition.xyz;
    output.worldNormal = (model.normalMatrix * vec4f(localNormal, 0.0)).xyz;
    return output;
}

@vertex
fn vertex(input: VertexInput) -> VertexOutput {
    return makeVertexOutput(vec4f(input.position, 1.0), input.normal, input.uv);
}

@vertex
fn vertexSkinned(input: SkinnedVertexInput) -> VertexOutput {
    let skin =
        input.weights.x * jointMatrices[input.joints.x] +
        input.weights.y * jointMatrices[input.joints.y] +
        input.weights.z * jointMatrices[input.joints.z] +
        input.weights.w * jointMatrices[input.joints.w];

    // The cofactor matrix gives the inverse-transpose direction for the skin transform.
    let x = skin[0].xyz;
    let y = skin[1].xyz;
    let z = skin[2].xyz;
    let yz = cross(y, z);
    let skinNormal = mat3x3f(yz, cross(z, x), cross(x, y)) * input.normal;
    let normal = select(skinNormal, -skinNormal, dot(x, yz) < 0.0);
    return makeVertexOutput(skin * vec4f(input.position, 1.0), normal, input.uv);
}

@fragment
fn fragment(input: VertexOutput) -> @location(0) vec4f {
    let base = textureSample(baseTexture, textureSampler, input.uv) * material.baseColorFactor;
    let normal = input.worldNormal * inverseSqrt(max(dot(input.worldNormal, input.worldNormal), 0.0001));
    var direct = vec3f(0.0);
    for (var i = 0u; i < arrayLength(&pointLights); i++) {
        let light = pointLights[i];
        if (light.positionIntensity.w <= 0.0) {
            continue;
        }
        let toLight = light.positionIntensity.xyz - input.worldPosition;
        let distanceSquared = dot(toLight, toLight);
        let safeDistanceSquared = max(distanceSquared, 0.0001);
        let lightDirection = toLight * inverseSqrt(safeDistanceSquared);
        let diffuse = max(dot(normal, lightDirection), 0.0);
        let relativeDistanceSquared = distanceSquared * light.colorInvRangeSquared.w;
        let rangeFactor = max(1.0 - relativeDistanceSquared * relativeDistanceSquared, 0.0);
        direct += light.colorInvRangeSquared.rgb * (diffuse * light.positionIntensity.w * rangeFactor / safeDistanceSquared);
    }
    let color = base.rgb * (vec3f(0.05) + direct * 0.22) + material.emission.rgb * 1.1;
    let peak = max(color.r, max(color.g, color.b));
    return vec4f(color / (1.0 + peak), base.a);
}
