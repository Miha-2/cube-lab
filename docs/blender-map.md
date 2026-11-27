# Blender gameplay properties

Name objects for organization, for example `R01_Cube_01`, `R01_Cube_02`, and `R02_Cube_01`.
Names do not enable pickup.

For each pickup cube, select its **mesh object** in Blender and add a string custom property:

```text
game_type = cube
```

Set this under **Object Properties > Custom Properties**, not on the mesh data or a parent empty.
Duplicating the tagged cube preserves the property. Each cube has its own carry state and collider;
the player can carry one cube at a time.

Export `data/map_new/map.blend` to `data/map_new/map.glb` with **Include > Custom Properties** enabled.
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
