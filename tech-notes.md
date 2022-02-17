# General

## three.js documentation

- [fundamentals](https://threejs.org/manual/#en/fundamentals)
- [textures](https://threejs.org/manual/#en/textures)


# Code organization

`constants.ts` contains definitions for vehicle colors and 3d object files and material files.

`index.tsx` is entry point which creates state (see `datastore.ts`) and passes the created event handlers to the `Root` (`root.tsx`) component, which is basically the `Sidebar` (`sidebar.tsx`).

A special initialization object `InitResources` (created `initialization.ts`) contains SUMO settings, network and models for vehicles and traffic light arrows.
These init resources are passed to `createStore` which uses it to construct an instance of `Sumo3D`, which is the place where rendering stuff is being done.
`createStore` also couples websocket updates to event handlers for drawing (`createVehicleObject`, `updateVehicleObject`, `removeVehicleObject`).

A settings file for the gui can be provided in `.sumocfg` files via the `gui_only.gui-settings-file` property.
See https://sumo.dlr.de/docs/Other/File_Extensions.html, https://sumo.dlr.de/xsd/sumoConfiguration.xsd and https://sumo.dlr.de/docs/sumo-gui.html#common_visualization_settings.
The toronto example settings file contains a `<viewport>` and `<delay>` tag, for example, but I am not sure if these are currently used by the project.
