import xml.etree.ElementTree as ET



def parse_fcd():
    # open file
    filepath = '../fcd.xml'
    with open(filepath, encoding='utf-8') as f:

        timestep = []

        for event, elem in ET.iterparse(f):
            if elem.tag == 'vehicle' and event == 'end':
                timestep.append(elem)

            elif elem.tag == 'timestep' and event == 'end':
                yield timestep
                timestep = []




for i, timestep in zip(range(10), parse_fcd()):
    print(f'timestep {i}')

    # vehicle_data = list(dict(filter(lambda dict_item: dict_item[0] in ['id', 'x', 'y'], vehicle.attrib.items())) for vehicle in timestep)
    # print(vehicle_data)



    vehicles = {vehicle.attrib['id']: vehicle.attrib['x'] for vehicle in timestep}
    print(vehicles)