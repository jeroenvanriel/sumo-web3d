#!/usr/bin/env python3
# Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
import argparse
from collections import Counter
import functools
import json
import os, sys
import re
import time
import ast
import xml.etree.ElementTree as ET
import xmltodict
import asyncio
import aiohttp
from aiohttp import web

from .sumo import *

# determine if the application is a frozen `.exe` (e.g. pyinstaller --onefile) 
if getattr(sys, 'frozen', False):
    DIR = os.path.dirname(sys.executable)
    SCENARIOS_PATH = os.path.join(DIR, 'scenarios/scenarios.json')
    SCENARIOS_DIR = os.path.join(DIR, 'scenarios/')

# or a script file (e.g. `.py` / `.pyw`)
elif __file__:
    DIR = os.path.join(os.path.dirname(__file__), '..')
    SCENARIOS_PATH = os.path.join(DIR, '../scenarios/scenarios.json')
    SCENARIOS_DIR = os.path.join(DIR, '../scenarios/')

from . import constants  # noqa
from .deltas import diff_dicts
from .xml_utils import get_only_key, parse_xml_file

NO_CACHE_HEADER = {'cache-control': 'no-cache'}

snapshot = {}
server = None

STATUS_OFF = 'off'
STATUS_RUNNING = 'running'
STATUS_PAUSED = 'paused'
simulation_status = STATUS_OFF
delay_length_ms = 30  # in ms
current_scenario = None
scenarios = {}  # map from kebab-case-name to Scenario object.

last_vehicles = {}
last_lights = {}


# meant to be used as decorator, will not work with coroutines
def send_as_http_response(func):
    def func_wrapper(*args, **kwargs):
        data = func(*args, **kwargs)
        if data and type(data) == str:
            return web.Response(text=data)
        elif data and type(data) != str:
            raise Exception(
                'fail to send as response, expecting string, recieved: {}'.format(type(data))
            )
        else:
            return web.Response(status=404, text='Not found')

    return func_wrapper


# meant to be used as decorator, will not work with coroutines
def serialize_as_json_string(func):
    def func_wrapper(*args, **kwargs):
        data = func(*args, **kwargs)
        if data:
            return json.dumps(data)
        else:
            return None

    return func_wrapper


def expand_path(filename):
    if not filename:
        return None
    return os.path.join(SCENARIOS_DIR, os.path.expanduser(os.path.expandvars(filename)))


def parse_lanemap_file(lane_map_file):
    if not lane_map_file:
        return None
    with open(lane_map_file) as f:
        # note that this only works for the specific current format
        return ast.literal_eval(f.readline())

class Scenario(object):

    @classmethod
    def from_config_json(cls, scenarios_json):
        name = scenarios_json['name']
        config_file = scenarios_json['config_file']
        sumocfg_file = expand_path(config_file)
        is_default = scenarios_json.get('is_default', False)
        config_dir = os.path.dirname(sumocfg_file)
        config = xmltodict.parse(open(sumocfg_file).read(), attr_prefix='')['configuration']
        net_file, additional_files, settings_file = parse_config_file(config_dir, config)

        # recorded simulation
        fcd_file = scenarios_json.get('fcd_file')
        if fcd_file:
            fcd_file = expand_path(fcd_file)

        # lane distributions file provided by Anna
        lane_distr_file = scenarios_json.get('lane_distr_file')
        if lane_distr_file:
            lane_distr_file = expand_path(lane_distr_file)

        # mapping from lane identifiers to lane distribution indices
        lanemap = parse_lanemap_file(expand_path(scenarios_json.get('lanemap_file')))

        additionals = {} if additional_files else None
        if additional_files:
            for xml in [parse_xml_file(f) for f in additional_files]:
                additional = xml.get('additional') or xml.get('add')
                if additional:
                    additionals.update(additional)

        settings = parse_xml_file(settings_file)
        water = {'type': 'FeatureCollection', 'features': []}
        if settings:
            water_tag = get_only_key(settings).get('water-geojson')
            if water_tag:
                water = json.load(open(os.path.join(config_dir, water_tag['value'])))

        return cls(
            sumocfg_file,
            name,
            is_default,
            parse_xml_file(net_file),
            additionals,
            settings,
            water,
            fcd_file,
            lane_distr_file,
            lanemap
        )

    def __init__(self, config_file, name, is_default, network, additional, settings, water, fcd_file, lane_distr_file, lanemap):
        self.config_file = config_file
        self.display_name = name
        self.name = to_kebab_case(name)
        self.is_default = is_default
        self.network = network
        self.additional = additional
        self.settings = settings
        self.water = water
        self.fcd_file = fcd_file
        self.lane_distr_file = lane_distr_file
        self.lanemap = lanemap
    
    def is_live(self):
        return self.fcd_file is None


def to_kebab_case(scenario_name):
    return scenario_name.lower().replace(' ', '-').replace('_', '-')


def get_state():
    return {
        'delayMs': delay_length_ms,
        'scenario': to_kebab_case(getattr(current_scenario, 'name')),
        'simulationStatus': simulation_status
    }


async def post_state(scenarios, request):
    global current_scenario, delay_length_ms, simulation_status
    body = await request.json()
    if body['scenario'] not in scenarios.keys():
        return None
    current_scenario = scenarios[body['scenario']]
    delay_length_ms = body['delay_length_ms']
    simulation_status = body['simulation_status']
    return web.Response(text=json.dumps({
        'delayMs': delay_length_ms,
        'scenario': to_kebab_case(getattr(current_scenario, 'name')),
        'simulationStatus': simulation_status
    }))


def state_http_response(request):
    return web.Response(
        text=json.dumps(get_state())
    )


# def vehicle_route_http_response(request):
#     vehicle_id = request.query_string
#     vehicle = last_vehicles.get(vehicle_id)
#     if vehicle:
#         if vehicle['vClass'] == 'pedestrian':
#             edge_ids = traci.person.getEdges(vehicle_id)
#         else:
#             edge_ids = traci.vehicle.getRoute(vehicle_id)
#         if edge_ids:
#             return web.Response(
#                 text=json.dumps(edge_ids)
#             )
#     return web.Response(status=404)


def get_state_websocket_message():
    state = get_state()
    state['type'] = 'state'
    return state


def make_xml_endpoint(path):
    text = None
    if path:
        r = xmltodict.parse(open(path).read(), attr_prefix='')
        text = json.dumps(r)

    async def handler(request):
        if text:
            return web.Response(text=text)
        else:
            return web.Response(status=404, text='Not found')

    return handler


def make_additional_endpoint(paths):
    """Make an endpoint for the "additional-files" setting.

    Since there can be several of these, we read them all and merge the results.
    """
    if not paths:  # Either None or empty list
        return make_xml_endpoint(paths)  # generate a generic 404.
    additionals = {}
    for path in paths:
        r = xmltodict.parse(open(path).read(), attr_prefix='')
        additionals.update(r['additional'])
    text = json.dumps({'additional': additionals})

    async def handler(request):
        return web.Response(text=text)

    return handler


def parse_fcd(fcd_file):
    """Generator function that reads floating car data (fcd) file
    in XML format timestep per timestep."""

    # open file
    with open(fcd_file, encoding='utf-8') as f:

        # buffer containing vehicle locations per timestep
        timestep = []

        for event, elem in ET.iterparse(f):
            if elem.tag == 'vehicle' and event == 'end':
                timestep.append(elem)

            elif elem.tag == 'timestep' and event == 'end':
                # output (timestep, buffered vehicle data attributes)
                yield elem.attrib['time'], [vehicle.attrib for vehicle in timestep]
                timestep = []


def parse_lane_distr(lane_distr_file):
    """Generator function that read the custom file format provided
    by Anna containing the distribution of vehicles per lane per timestep."""

    with open(lane_distr_file) as f:
        lines = f.readlines()
        line = lines.pop(0)
        data = [ line.replace('[[', '') ]
        for line in lines:
            # TODO: make this parser not depend on the particular formatting
            if re.match(f'\]\]', line):
                break
            elif not re.match(r'\], \[', line):
                data.append(ast.literal_eval(line.replace(', ', '', 1)))
            else:
                yield data
                # parse first line of timestep
                data = [ line.replace('], [', '') ]


def parse_color(vehicle):
    return { # list [r, g, b] with [0, 255]
        'color': list(map(str.strip, vehicle['color'].split(',')))
        } if 'color' in vehicle else {}


def read_fcd_vehicle(vehicle):
    if vehicle['type'] == 'DEFAULT_VEHTYPE':
        vehicle['type'] = 'car'
    return {
        'x': float(vehicle['x']),
        'y': float(vehicle['y']),
        'z': 0,
        'speed': float(vehicle['speed']),
        'angle': vehicle['angle'],
        'type': vehicle['type'],
        'vClass': vehicle['vClass'] if 'vClass' in vehicle else 'passenger',
        'length': 4.5,
        'width': 1.8,
        'signals': 0,
        **parse_color(vehicle),
    }


def read_next_step(timestep, vehicles):
    """Given a list of vehicle data, produce a snapshot to be send to
    the frontend. Use this function instead of simulate_next_step in
    case the simulation has been prerecorded."""

    global last_lights, last_vehicles

    start_secs = time.time()
    end_sim_secs = time.time()

    vehicles = {vehicle['id']: read_fcd_vehicle(vehicle) for vehicle in vehicles}
    vehicle_counts = Counter(v['vClass'] for veh_id, v in vehicles.items())

    vehicles_update = diff_dicts(last_vehicles, vehicles)

    end_update_secs = time.time()

    snapshot = {
        # 'time': traci.simulation.getCurrentTime(), # previously 
        # we want recorded (fcd) simulations to run offline
        'time': str(float(timestep) * 1000), # frontend assumes milliseconds
        'vehicles': vehicles_update,
        # 'lights': lights_update,
        'vehicle_counts': vehicle_counts,
        'simulate_secs': end_sim_secs - start_secs, # currently this yields near 0
        'snapshot_secs': end_update_secs - end_sim_secs
    }
    last_vehicles = vehicles
    return snapshot


async def run_simulation(ws):
    global current_scenario

    # floating car data (fcd) file recorded by SUMO
    fcd_parser = parse_fcd(current_scenario.fcd_file) if current_scenario.fcd_file else None

    # custom lane distribution format of Anna
    lane_distr_parser = parse_lane_distr(current_scenario.lane_distr_file) if current_scenario.lane_distr_file else None

    while True:
        if simulation_status is STATUS_RUNNING:
            if fcd_parser:
                # read recorded vehicle positions and possibly lane distributions
                timestep, vehicles = next(fcd_parser)
                snapshot = read_next_step(timestep, vehicles)
            else:
                # get next step from running sumo executable
                snapshot = simulate_next_step()
            
            if lane_distr_parser:
                lane_distributions = next(lane_distr_parser) 
                snapshot['lane_distributions'] = lane_distributions

            snapshot['type'] = 'snapshot'
            try:
                await ws.send_str(json.dumps(snapshot))
            except ConnectionResetError:
                print('client closed connection')
                return
            await asyncio.sleep(delay_length_ms / 1000)
        else:
            await asyncio.sleep(0)


def cleanup_sumo_simulation(simulation_task, live):
    global last_lights, last_vehicles
    if simulation_task:
        if simulation_task.cancel():
            simulation_task = None
        last_vehicles = {}
        last_lights = {}
        if live: # only need to close connection when SUMO was actually started
            stop_sumo()


async def websocket_simulation_control(sumo_start_fn, request):
    # We use globals to communicate with the simulation coroutine for simplicity
    global current_scenario, delay_length_ms, simulation_status

    task = None
    live = current_scenario.is_live()

    ws = web.WebSocketResponse()
    await ws.prepare(request)

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.TEXT:
            msg = json.loads(msg.data)
            if msg['type'] == 'action':
                if msg['action'] == 'start':
                    if live:
                        sumo_start_fn()
                        print('started sumo')
                    simulation_status = STATUS_RUNNING
                    loop = asyncio.get_event_loop()
                    task = loop.create_task(run_simulation(ws))
                elif msg['action'] == 'pause':
                    simulation_status = STATUS_PAUSED
                elif msg['action'] == 'resume':
                    simulation_status = STATUS_RUNNING
                elif msg['action'] == 'cancel':
                    simulation_status = STATUS_OFF
                    cleanup_sumo_simulation(task, live)
                elif msg['action'] == 'changeDelay':
                    delay_length_ms = msg['delayLengthMs']
                else:
                    raise Exception('unrecognized action websocket message')
                await ws.send_str(json.dumps(get_state_websocket_message()))
            else:
                raise Exception('unrecognized websocket message')

        # we need to handle implicit cancelling, ie the client closing their browser
        elif msg.type == aiohttp.WSMsgType.ERROR:
            simulation_status = STATUS_OFF
            cleanup_sumo_simulation(task, live)

    return ws


def parse_config_file(config_dir, config):
    input_config = config['input']
    net_file = os.path.join(config_dir, input_config['net-file']['value'])

    additionals = input_config.get('additional-files', [])
    if additionals:
        # With a single additional file, additionals is an OrderedDict.
        # With multiple additional files, it's a list of OrderedDicts.
        # This logic normalizes it to always be the latter.
        # Additionally, files may be specified either via multiple tags or via
        # space-separated or comma-separated file names in the value attribute.
        if not isinstance(additionals, list):
            additionals = [additionals]
        additional_files = []
        for additional in additionals:
            values = re.split(r'[ ,]+', additional['value'])
            for value in values:
                additional_files.append(os.path.join(config_dir, value))
    else:
        additional_files = None

    settings_file = None
    if 'gui_only' in config and 'gui-settings-file' in config['gui_only']:
        settings_file = os.path.join(config_dir, config['gui_only']['gui-settings-file']['value'])
    return (net_file, additional_files, settings_file)


def scenario_to_response_body(scenario):
    return {
        'displayName': scenario.name,
        'kebabCase': to_kebab_case(scenario.name)
    }


def get_scenarios_route(scenarios_file, scenarios):
    scenarios = load_scenarios_file(scenarios, scenarios_file)


@send_as_http_response
@serialize_as_json_string
def scenario_attribute_route(scenarios_file, scenarios, attribute, normalized_key, request):
    requested_scenario = request.match_info['scenario']
    if requested_scenario not in scenarios:
        scenarios = load_scenarios_file(scenarios, scenarios_file)
    if requested_scenario in scenarios:
        obj = getattr(scenarios[requested_scenario], attribute)
        if normalized_key and obj:
            obj = {normalized_key: get_only_key(obj)}
        return obj
    else:
        return None


def load_scenarios_file(prev_scenarios, scenarios_file):
    next_scenarios = prev_scenarios
    if not scenarios_file:
        return next_scenarios

    with open(scenarios_file) as f:
        new_scenarios = json.loads(f.read())
        new_scenarios_names = [to_kebab_case(x['name']) for x in new_scenarios]
        # throw error if there are duplicate name fields
        duplicates = len(new_scenarios_names) != len(set(new_scenarios_names))
        if duplicates:
            raise Exception(
                'Invalid scenarios.json, cannot have two scenarios with the'
                'same kebab case name'
            )
        prev_scenario_names = set([s.name for s in prev_scenarios.values()])
        updates = [s for s in new_scenarios if to_kebab_case(s['name']) not in prev_scenario_names]
        for new_scenario in updates:
            scenario = Scenario.from_config_json(new_scenario)
            next_scenarios.update({scenario.name: scenario})
        return next_scenarios


def get_new_scenario(request):
    """Set a new scenario and respond with index.html"""
    global current_scenario
    scenario_name = request.match_info['scenario']
    print('Switching to %s' % scenario_name)
    # The simulation will be restarted via a websocket message.
    current_scenario = scenarios[scenario_name]
    # We avoid web.FileResponse here because we want to disable caching.
    html = open(os.path.join(DIR, 'static', 'index.html')).read()
    return web.Response(text=html, content_type='text/html', headers=NO_CACHE_HEADER)


def get_default_scenario_name(scenarios):
    """Find the Scenario with is_default, or a random one."""
    defaults = [k for k, s in scenarios.items() if s.is_default]
    if len(defaults) > 1:
        raise ValueError('Multiple scenarios with is_default set: %s', ', '.join(defaults))
    if len(defaults) == 0:
        return scenarios.keys()[0]  # pick a random scenario
    return defaults[0]


def read_config(request):
    with open(os.path.join(DIR, 'static', 'config.json'), 'r') as infile:
        data = json.load(infile)
        return web.json_response(data)


async def write_config(request):
    data = await request.json()
    with open(os.path.join(DIR, 'static', 'config.json'), 'w') as outfile:
        outfile.write(json.dumps(data))
    return web.Response(status=201)


def setup_http_server(scenario_file, scenarios):
    app = web.Application()

    scenarios_response = [scenario_to_response_body(x) for x in scenarios.values()]
    default_scenario_name = get_default_scenario_name(scenarios)

    app.router.add_get(
        '/scenarios/{scenario}/additional',
        functools.partial(scenario_attribute_route, scenario_file, scenarios, 'additional', None)
    )
    app.router.add_get(
        '/scenarios/{scenario}/network',
        functools.partial(scenario_attribute_route, scenario_file, scenarios, 'network', None)
    )
    app.router.add_get(
        '/scenarios/{scenario}/water',
        functools.partial(scenario_attribute_route, scenario_file, scenarios, 'water', None)
    )
    app.router.add_get(
        '/scenarios/{scenario}/settings',
        functools.partial(
            scenario_attribute_route, scenario_file, scenarios, 'settings', 'viewsettings')
    )
    app.router.add_get(
        '/scenarios/{scenario}/lanemap',
        functools.partial(scenario_attribute_route, scenario_file, scenarios, 'lanemap', None)
    )
    app.router.add_get('/scenarios/{scenario}/', get_new_scenario)

    app.router.add_get(
        '/scenarios',
        lambda request: web.Response(text=json.dumps(scenarios_response))
    )
    # app.router.add_get(
    #     '/poly-convert',
    #     make_xml_endpoint(os.path.join(SUMO_HOME, 'data/typemap/osmPolyconvert.typ.xml'))
    # )
    app.router.add_get('/state', state_http_response)
    app.router.add_post('/state', functools.partial(post_state, scenarios))
    # app.router.add_get('/vehicle_route', vehicle_route_http_response)
    app.router.add_get('/', lambda req: web.HTTPFound(
        '/scenarios/%s/' % default_scenario_name, headers=NO_CACHE_HEADER))
    
    app.router.add_get('/config', read_config)
    app.router.add_post('/config', write_config)

    return app


def main(args):
    global current_scenario, scenarios, SCENARIOS_PATH

    if args.configuration_file:
        # Replace the built-in scenarios with a single, user-specified one.
        # We don't merge the lists to avoid clashes with two scenarios having is_default set.
        SCENARIOS_PATH = None
        name = os.path.basename(args.configuration_file)
        scenarios = {
            to_kebab_case(name): Scenario.from_config_json({
                'name': name,
                'description': 'User-specified scenario',
                'config_file': args.configuration_file,
                'is_default': True
            })
        }
    else:
        scenarios = load_scenarios_file({}, SCENARIOS_PATH)

    sumo_start_fn = functools.partial(start_sumo, args.gui, args.sumo_args)
    ws_handler = functools.partial(
            websocket_simulation_control,
            lambda: sumo_start_fn(getattr(current_scenario, 'config_file'))
        )

    app = setup_http_server(SCENARIOS_PATH, scenarios)
    app.router.add_get('/ws', ws_handler)
    app.router.add_static('/', path=os.path.join(DIR, 'static'))

    port = int(os.environ.get('PORT', 8080))
    print(f"port={port}")
    web.run_app(app, port=port)


def run():
    parser = argparse.ArgumentParser(description='Run the microsim python server.')
    parser.add_argument(
        '-c', '--configuration-file', dest='configuration_file', default='',
        help='Run SUMO3D with a specific configuration. The default is to run ' +
            'with a built-in list of scenarios, e.g. for demoing.')
    parser.add_argument(
        '--sumo-args', dest='sumo_args', default='',
        help='Additional arguments to pass to the sumo (or sumo-gui) process. ' +
            'For example, "--step-length 0.01" or "--scale 10".')
    parser.add_argument(
        '--gui', action='store_true', default=False,
        help='Run sumo-gui rather than sumo. This is useful for debugging.')
    args = parser.parse_args()
    main(args)


if __name__ == '__main__':
    run()
