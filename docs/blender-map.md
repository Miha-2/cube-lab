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

Run `npm run test:cube-carry` to check property import and pickup behavior.
