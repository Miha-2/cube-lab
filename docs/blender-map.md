# Blender gameplay properties

## Blender source files

- `data/assets/assets.blend`: modular walls, cubes, levers, and other reusable map parts.
- `data/map/map.blend`: current map source.
- `data/map/map.glb`: current exported map loaded by the game.

Keep both Blender source files in Git. Blender's numbered backup files are ignored.

Name objects for organization, for example `R01_Cube_01`, `R01_Cube_02`, and `R02_Cube_01`.
Names do not enable pickup.

For each pickup cube, select its **mesh object** in Blender and add a string custom property:

```text
game_type = cube
```

Set this under **Object Properties > Custom Properties**, not on the mesh data or a parent empty.
Duplicating the tagged cube preserves the property. Each cube has its own carry state and collider;
the player can carry one cube at a time.

Export `data/map/map.blend` to `data/map/map.glb` with **Include > Custom Properties** enabled.
The importer reads the exported glTF `extras.game_type` and adds the `Carryable` component.
Other objects, including objects merely named `CUBE`, are not automatically carryable.

Collision boxes live in the `R01_Collision` collection. Each is a unit-box mesh
with the string property `collision_type = box`. Resize them using object scale,
not Edit Mode: their scale provides the collision half-extents. Parent a box to
its moving visual object (cube, door leaf, or pressure-plate button).

The game omits these helper meshes from rendering. Ordinary visible meshes,
including lights and cables, do not automatically collide. The door frame uses
three boxes so its opening stays clear when the leaves move.

When exporting, enable **Custom Properties** and **Active Scene**, and leave
**Selected Objects**, **Visible Objects**, and **Renderable Objects** unchecked.
Collision helpers are hidden from Blender renders but must still be exported.
The player can automatically step onto flat obstacles up to 0.2 m high when
grounded, provided there is enough headroom.

After building, `node tests/cube-carry.mjs` checks pickup and
`node tests/box-collision.mjs` checks stepping.

## Lighting

The renderer supports Blender **Point** lights. Export with **Punctual Lights**
enabled and the default Standard lighting conversion. Area lights and Blender's
preview/world lighting are not exported as game lighting.

The current map has three point lights in `R01_Lighting`. Their low Blender power
is intentional: standard glTF export converts it to candela, which the game uses
with inverse-square attenuation. Increase or decrease Power in Blender to tune it.

Solid-color emission and `KHR_materials_emissive_strength` are supported for the
existing strips and cables. Emissive surfaces stay bright without illuminating
surroundings. The room uses low ambient lighting and hue-preserving tone mapping
to keep neon colors distinct. Bloom and shadows are not implemented.

## Device and cable colors

The color-state system is ready; plate detection, lever interaction, keypad entry,
and door movement are separate mechanics and are not implemented by this system.

- Active indicators and cables: bright green (`#39FF14`, emission strength 2).
- Inactive signal indicators and cables: frosted light grey (`#B8C2CC`, opaque with no emission).
- Inactive keypad indicators: red (`#FF0022`, emission strength 0.35).
- Laser beams retain their red materials. Decorative blue and warm-orange lights,
  white keypad text, cube lighting and ceiling lighting stay unchanged.
- Only the plate outline, lever status LED, lever cable ports, cable strips and
  keypad status LEDs change with a signal. Door outlines and blue strips are decorative.

The assets use one model per device, with separate indicator meshes. The importer
creates independent materials for each tagged indicator so one circuit cannot
change another circuit's color. Only changed indicator material buffers are uploaded.

### Setting up connections in Blender

Append the device's parent empty **and all its children** from
`data/assets/assets.blend`. Keep the hierarchy. On the parent empty, under
**Object Properties > Custom Properties**, set:

| Property | Type | Meaning |
| --- | --- | --- |
| `signal_id` | String | Unique ID for this device or cable, such as `plate_01` or `cable_01`. |
| `signal_source` | String | ID to follow, such as `plate_01`. Leave empty on independently controlled devices. |
| `signal_active` | Boolean | Initial on/off state for an independently controlled device; normally false. |

Give every duplicated device and cable a **new signal_id**. Blender does not
update these strings when it renames duplicated objects. Every cable segment in a
route can follow the same source; cables do not need to physically touch for the
color system to work. Following another connected device is also supported.
Missing sources, duplicate IDs and connection loops report an error when loading.
A following device ignores its own `signal_active` and uses its source's state.

The indicator children already have `state_indicator = grey` (or `red` for
keypads). Leave this property on the indicator meshes only. It recolors every
material on that mesh; do not tag a combined mesh containing the device body.
Do not tag laser meshes, white keypad text, cube lighting or ceiling lights.

In the current map, `R01_PressurePlate` drives `R01_Door01_ToLeverRoom` and every
`R01_PlateCable_*` root. `R01_FreestandingLever` drives `R01_Door02_Exit` and every
`R01_LeverCable_*` root. Both sources start inactive. These are color connections;
they do not yet press buttons or move doors.

### Connecting future game logic

Call the shared function when the mechanic changes state:

```ts
import { setSignalActive } from "./systems/SignalSystem.ts";

setSignalActive(scene, "R01_PressurePlate", true);  // Green, including connected indicators.
setSignalActive(scene, "R01_PressurePlate", false); // Unpowered grey again.
```

The same function works for an independent lever, keypad or door signal. Change
the source device, not a cable or door that follows it. There is no need to swap
models or create new GPU materials when toggling a state.

### Exporting after future edits

1. Build the map in `data/map/map.blend`, keeping device hierarchies and unique IDs.
2. Export **glTF 2.0**, format **glTF Binary (.glb)**, to `data/map/map.glb`.
3. Enable **Custom Properties**, **Active Scene** and **Punctual Lights**.
4. Leave **Selected Objects**, **Visible Objects** and **Renderable Objects** disabled
   so hidden collision boxes are included. Export materials normally.
5. Reload the game. The game reads the GLB, not either Blender source file.

You do not need to export `assets.blend` separately for the game. Append its
updated assets into the map, then export the map. Existing appended map objects
are independent copies; editing `assets.blend` does not update them automatically.
The current map source and GLB have already been updated for these color states.

Run `npm run test:signals` to check map connections, independent materials,
active/inactive transitions and changed-material GPU uploads. To also check a
separately exported asset-library GLB, pass its path to
`node tests/signal-states.mjs /absolute/path/to/assets.glb` after building.
