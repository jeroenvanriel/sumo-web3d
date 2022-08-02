# Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html

# This config controls which vehicles are simulated
# Params values can be adjusted as needed for each vehicle type
#   prefix <STRING>: used to name each vehicle
#   quantity <INT>: num of vehicles to simulate
#   period <INT>: the interval at which vehicles depart
#   min_distance <FLOAT>: min distance (in meter) between start and end edges of a trip
#   max_distance <FLOAT>: max distance (in meter) between start and end edges of a trip,
#   speed_factor <FLOAT>: vehicle's expected multiplicator for lane speed limit
#                         applied directly to the max speed for pedestrians
#                         can also be a distribution used to sample a vehicle specific speed factor

VEHICLE_PARAMS = {
    'passenger': {
        'prefix': 'veh',
        'quantity': 1800,
        'period': 2,
        'min_distance': 300,
        'max_distance': None,
        'speed_factor': 'normc(1.00,0.10,0.20,2.00)',
    },
    'bicycle': {
        'prefix': 'bike',
        'quantity': 1800,
        'period': 2,
        'min_distance': 300,
        'max_distance': None,
        'speed_factor': 'normc(1.00,0.10,0.20,2.00)',
    },
    'pedestrian': {
        'prefix': 'ped',
        'quantity': 1800,
        'period': 2,
        'min_distance': 300,
        'max_distance': None,
        'speed_factor': '1.3',
    },
}
