import { vec4 } from "gl-matrix";
import { Mesh } from "../components/Mesh.ts";
import { SignalIndicator } from "../components/SignalIndicator.ts";
import { SignalState } from "../components/SignalState.ts";
import { BasicMaterial } from "../data/Material.ts";
import type { Entity } from "../Entity.ts";
import type { Scene } from "../Scene.ts";

// Linear RGB, matching Blender materials: #39FF14, #B8C2CC, #FF0022.
const green = [0.0409152, 1, 0.00699541] as const;
const grey = [0.47932018, 0.53947949, 0.60382734] as const;
const red = [1, 0, 0.0159963] as const;

function getSignals(scene: Scene) {
    const signals = new Map<string, SignalState>();
    for (const entity of scene.getEntitiesByComponent(SignalState)) {
        const signal = entity.getComponent(SignalState)!;
        if (signals.has(signal.id)) throw Error(`Duplicate signal_id: ${signal.id}`);
        signals.set(signal.id, signal);
    }
    return signals;
}

function resolveActive(signal: SignalState, signals: Map<string, SignalState>, path = new Set<string>()): boolean {
    if (path.has(signal.id)) throw Error(`Signal connection cycle at ${signal.id}`);
    if (!signal.source) return signal.active;
    const source = signals.get(signal.source);
    if (!source) throw Error(`Signal ${signal.id} references missing signal_source: ${signal.source}`);
    path.add(signal.id);
    const active = resolveActive(source, signals, path);
    path.delete(signal.id);
    return active;
}

function getOwner(entity: Entity) {
    for (let owner: Entity | null = entity; owner; owner = owner.parent) {
        const signal = owner.getComponent(SignalState);
        if (signal) return signal;
    }
}

/** Call from pressure-plate, lever, keypad, or door logic when its state changes. */
export function setSignalActive(scene: Scene, id: string, active: boolean) {
    const signal = getSignals(scene).get(id);
    if (!signal) throw Error(`Unknown signal_id: ${id}`);
    if (signal.source) throw Error(`Signal ${id} follows ${signal.source}; change that source instead`);
    signal.active = active;
    updateSignalIndicators(scene);
}

/** Run before GPU buffer creation and each frame; only changed indicators are uploaded. */
export function updateSignalIndicators(scene: Scene) {
    const signals = getSignals(scene);
    const states = new Map<SignalState, boolean>();
    for (const signal of signals.values()) states.set(signal, resolveActive(signal, signals));
    for (const entity of scene.getEntitiesByComponent(SignalIndicator)) {
        const indicator = entity.getComponent(SignalIndicator)!;
        const owner = getOwner(entity);
        if (!owner) throw Error(`Indicator ${entity.name} needs a parent with signal_id`);
        const active = states.get(owner)!;
        if (active === indicator.lastActive) continue;
        const color = active ? green : indicator.inactiveColor === "red" ? red : grey;
        const strength = active ? 2 : indicator.inactiveColor === "red" ? 0.35 : 0;
        for (const primitive of entity.getComponent(Mesh)?.getPrimitivesByMaterial(BasicMaterial) ?? []) {
            const material = primitive.material as BasicMaterial;
            vec4.set(material.baseColor, color[0], color[1], color[2], 1);
            vec4.set(material.emission, color[0] * strength, color[1] * strength, color[2] * strength, 0);
        }
        indicator.lastActive = active;
        indicator.dirty = true;
    }
}
