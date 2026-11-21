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
    color: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> light: PointLight;
@group(1) @binding(0) var<uniform> model: Model;
@group(2) @binding(0) var<uniform> baseColorFactor: vec4f;
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
    let base = textureSample(baseTexture, textureSampler, input.uv) * baseColorFactor;
    let toLight = light.positionIntensity.xyz - input.worldPosition;
    let distanceSquared = max(dot(toLight, toLight), 0.0001);
    let lightDirection = toLight * inverseSqrt(distanceSquared);
    let normal = input.worldNormal * inverseSqrt(max(dot(input.worldNormal, input.worldNormal), 0.0001));
    let diffuse = max(dot(normal, lightDirection), 0.0);
    let direct = light.color.rgb * (diffuse * light.positionIntensity.w / distanceSquared);
    let ambient = vec3f(0.3);
    return vec4f(base.rgb * (ambient + direct), base.a);
}
