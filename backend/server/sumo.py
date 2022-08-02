# cleanup_sumo_simulation
# vehicle_route_http_response
# simulate_next_step

import shlex
import time
import os, sys
from collections import Counter

from .deltas import round_vehicles, diff_dicts

SUMO_IMPORT_ERROR_MSG = ('please declare environment variable \'SUMO_HOME\' as the root directory'
                         'of your sumo installation (it should contain folders /bin, /tools and'
                         '/docs)')

# we need to import python modules from the $SUMO_HOME/tools directory ....
# this is a hack borrowed from the sumo code base
# SUMO_HOME = os.environ.get('SUMO_HOME')
SUMO_HOME = None
# assert SUMO_HOME, 'Make sure the SUMO_HOME environment variable is set.'
if not SUMO_HOME:
    sumo = False
else:
    try:

        sys.path.append(os.path.join(SUMO_HOME, 'tools'))

        import sumolib
        import traci

        tc = traci.constants

        # We use these to tell TraCI which parameters we want to track.
        TRACI_CONSTANTS = [
            tc.VAR_TYPE,
            tc.VAR_SPEED,
            tc.VAR_ANGLE,
            tc.VAR_LENGTH,
            tc.VAR_WIDTH,
        ]

        TRACI_PERSON_CONSTANTS = TRACI_CONSTANTS + [
            tc.VAR_POSITION,
            tc.VAR_VEHICLE
        ]

        TRACI_VEHICLE_CONSTANTS = TRACI_CONSTANTS + [
            tc.VAR_POSITION3D,
            tc.VAR_SIGNALS,
            tc.VAR_VEHICLECLASS,
        ]


        def person_to_dict(person):
            """Extracts relevant information from what traci.person.getSubscriptionResults."""
            return {
                'x': person[tc.VAR_POSITION][0],
                'y': person[tc.VAR_POSITION][1],
                'z': 0,
                'speed': person[tc.VAR_SPEED],
                'angle': person[tc.VAR_ANGLE],
                'type': person[tc.VAR_TYPE],
                'length': person[tc.VAR_LENGTH],
                'width': person[tc.VAR_WIDTH],
                'person': person.get(tc.VAR_VEHICLE),
                'vClass': 'pedestrian',
            }


        def vehicle_to_dict(vehicle):
            """Extracts relevant information from what traci.vehicle.getSubscriptionResults."""
            return {
                'x': vehicle[tc.VAR_POSITION3D][0],
                'y': vehicle[tc.VAR_POSITION3D][1],
                'z': vehicle[tc.VAR_POSITION3D][2],
                'speed': vehicle[tc.VAR_SPEED],
                'angle': vehicle[tc.VAR_ANGLE],
                'type': vehicle[tc.VAR_TYPE],
                'length': vehicle[tc.VAR_LENGTH],
                'width': vehicle[tc.VAR_WIDTH],
                'signals': vehicle[tc.VAR_SIGNALS],
                'vClass': vehicle.get(tc.VAR_VEHICLECLASS),
            }


        def light_to_dict(light):
            """Extract relevant information from traci.trafficlight.getSubscriptionResults."""
            return {
                'phase': light[tc.TL_CURRENT_PHASE],
                'programID': light[tc.TL_CURRENT_PROGRAM],
            }

        sumo = True

    except ImportError:
        # sys.exit(SUMO_IMPORT_ERROR_MSG)
        pass
        sumo = False

# TraCI business logic
def start_sumo(gui, sumo_args, sumocfg_file):
    if not sumo:
        return

    sumoBinary = sumolib.checkBinary('sumo' if not gui else 'sumo-gui')
    additional_args = shlex.split(sumo_args) if sumo_args else []
    args = [sumoBinary, '-c', sumocfg_file] + additional_args
    print('Executing %s' % ' '.join(args))
    traci.start(args)
    traci.simulation.subscribe()

    # Subscribe to all traffic lights. This set of IDs should never change.
    for light_id in traci.trafficlight.getIDList():
        traci.trafficlight.subscribe(light_id, [
            tc.TL_CURRENT_PHASE,
            tc.TL_CURRENT_PROGRAM
        ])


def stop_sumo():
    if not sumo:
        return

    traci.close()


def simulate_next_step(last_lights, last_vehicles):
    if not sumo:
        return

    start_secs = time.time()
    traci.simulationStep()
    end_sim_secs = time.time()
    # Update Vehicles
    for veh_id in traci.simulation.getDepartedIDList():
        # SUMO will not resubscribe to vehicles that are already subscribed, so this is safe.
        traci.vehicle.subscribe(veh_id, TRACI_VEHICLE_CONSTANTS)

    # acquire the relevant vehicle information
    ids = tuple(set(traci.vehicle.getIDList() +
                    traci.simulation.getSubscriptionResults()
                    [tc.VAR_DEPARTED_VEHICLES_IDS]))
    vehicles = {veh_id: vehicle_to_dict(traci.vehicle.getSubscriptionResults(veh_id))
                for veh_id in ids}
    # Vehicles are automatically unsubscribed upon arrival
    # and deleted from vehicle list on next
    # timestep. Persons are also automatically unsubscribed.
    # See: http://sumo.dlr.de/wiki/TraCI/Object_Variable_Subscription).

    # Update persons
    # Workaround for people: traci does not return person objects in the getDepartedIDList() call
    # See: http://sumo.dlr.de/trac.wsgi/ticket/3477
    for ped_id in traci.person.getIDList():
        traci.person.subscribe(ped_id, TRACI_PERSON_CONSTANTS)
    person_ids = traci.person.getIDList()

    persons = {p_id: person_to_dict(traci.person.getSubscriptionResults(p_id))
               for p_id in person_ids}

    # Note: we might have to separate vehicles and people if their data models or usage deviate
    # but for now we'll combine them into a single object
    vehicles.update(persons)
    vehicle_counts = Counter(v['vClass'] for veh_id, v in vehicles.items())
    round_vehicles(vehicles)
    vehicles_update = diff_dicts(last_vehicles, vehicles)

    # Update lights
    light_ids = traci.trafficlight.getIDList()
    lights = {l_id: light_to_dict(traci.trafficlight.getSubscriptionResults(l_id))
              for l_id in light_ids}
    lights_update = diff_dicts(last_lights, lights)

    end_update_secs = time.time()

    snapshot = {
        'time': traci.simulation.getTime(),
        'vehicles': vehicles_update,
        'lights': lights_update,
        'vehicle_counts': vehicle_counts,
        'simulate_secs': end_sim_secs - start_secs,
        'snapshot_secs': end_update_secs - end_sim_secs
    }
    last_vehicles = vehicles
    last_lights = lights
    return snapshot
