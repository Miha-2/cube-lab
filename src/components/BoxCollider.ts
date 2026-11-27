import type { Component } from "../Component.ts";
import type { Transform } from "./Transform.ts";

/** Marks a box whose half-extents come from its Transform scale. */
export class BoxCollider implements Component {
    source?: Transform;
}
