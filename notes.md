## Scenarios

Use the graphical [`netedit`](https://sumo.dlr.de/docs/Netedit/index.html) tool to create a traffic network `simple.net.xml` and a demand file `simple.rou.xml`.
The [Hello World](https://sumo.dlr.de/docs/Tutorials/Hello_World.html) tutorial on the SUMO website includes a description to create a simple network.
It also shows how to open `sumo-gui` from `netedit` to create the configuration file `simple.sumocfg`.

After you have verified that the simulation runs in `sumo-gui`, use the command `sumo -c simple.sumocfg --fcd-output fcd.xml` to create a floating car data export, see [FCDOutput](https://sumo.dlr.de/docs/Simulation/Output/FCDOutput.html).

Configuration files for a specific scenario are kept in a separate folder like `sumo_web3d/scenarios/simple-crossing/`.
These files must be referenced appropriately in the `./sumo_web3d/scenarios.json` file.
To include our newly created example, add the following entry:
```
    {
        "name": "simple-crossing",
        "description": "Simple crossing with traffic lights",
        "config_file": "scenarios/simple-crossing/simple.sumocfg",
        "fcd_file": "scenarios/simple-crossing/fcd.xml"
    }
```
Note that json does not allow trailing commas.

A recorded simulation is provided via the `fcd_file` attribute.
When this attribute is not present, the SUMO simulator will be started in the background and visualized.

We can now test our new example by starting the server with
```
python sumo_web3d.py
```
and navigating to `http:localhost:5000/simple-crossing/` (note trailing slash).


## Offline running of recorded simulation
Currently, we start SUMO even if we are playing a prerecorded simulation and we use `traci.simulation.getCurrentTime()` while creating the snapshot.
This is not necessary, because the timing is already handled in the Python script itself.
