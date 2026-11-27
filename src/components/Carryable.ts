import type { Component } from "../Component.ts";
import type { Transform } from "./Transform.ts";

export class Carryable implements Component {
    collider: Transform | undefined;
    fallSpeed = 0;
}
