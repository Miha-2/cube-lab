import type { Component } from "../Component.ts";

/** Only explicitly tagged indicator meshes change color. */
export class SignalIndicator implements Component {
    lastActive: boolean | undefined;
    dirty = false;
    constructor(public inactiveColor: "grey" | "red") {}
}
