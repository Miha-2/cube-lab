import type { Component } from "../Component.ts";

/** A device's state, or a connection following another device's signal. */
export class SignalState implements Component {
    constructor(public id: string, public source = "", public active = false) {}
}
