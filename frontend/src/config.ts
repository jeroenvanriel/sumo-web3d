import * as _ from 'lodash';
import * as dat from 'dat.gui/build/dat.gui.js';

import { ModelParams, SupportedVehicle } from './initialization';

type DatConfig = Record<string, Record<string, any>> ;

export interface Config {
    vehicles: { [sumoVehicleType: string]: SupportedVehicle };
    models: { [modelName: string]: ModelParams };
    datConfig: DatConfig;
}

export class ConfigManager {
    private gui: typeof dat.gui.GUI;

    public config: Config;

    public datConfig : DatConfig = {
        vehicle: {
            colorSpeed: { value: true },
            colorSpeedMax: { value: 15 },
            colorSpeedLow: { color: [255, 0, 0] },
            colorSpeedHigh: { color: [0, 255, 0] },
        },
        environment: {
            groundPlane: { value: true },
            trees: { value: true },
            buildings: { value: false },
            trafficLight: { value: true },
            trafficLightOffset: { value: 7, min: 0, max: 20 },
        },
    }

    public controllers : { [category: string] :
            { [key: string] : typeof dat.gui.Controller } };

    constructor() {
        this.listen = this.listen.bind(this)
        this.loadFromFile = this.loadFromFile.bind(this)
    }

    async loadFromFile() {
        const data = await fetch('/config.json');
        this.config = await data.json();

        this.gui = new dat.gui.GUI();


        for (const category in this.datConfig) {
            console.log(category)
            const folder = this.gui.addFolder(category);
            (this.config.datConfig ??= {})[category] = {};
            const cat = this.config.datConfig[category];

            _.forEach(this.datConfig[category], (entry, key) => {
                // copy value from defaults
                cat[key] = entry;

                let controller = null;
                if (_.has(cat[key], 'value')) {
                    controller = folder.add(cat[key], 'value', entry.min, entry.max);
                } else if (_.has(entry, 'color')) {
                    controller = folder.addColor(cat[key], 'color');
                }
                if (controller) {
                    controller.name(key);
                    ((this.controllers ??= {})[category] ??= {})[key] = controller;
                }
            })
        }
    }

    get(category: string, entry: string) {
        const c = this.config.datConfig[category][entry];
        if (_.has(c, 'value')) { return c.value }
        else if (_.has(c, 'color')) {
            let cols: number[] = [0, 0, 0];
            if (typeof c.color == 'string') {
                cols = hexToRgb(c.color);
            } else {
                cols = c.color;
            }
            // rescaling to be used with three.Color()
            return cols.map(v => v / 255)
        }
    }

    listen(listener: Function, category: string, entry: string = '') {
        if (entry == '') {
            _.forEach(this.controllers[category], (controller, key) => {
                controller.onChange(listener);
            });
        } else {
            this.controllers[category][entry].onChange(listener);
        }
    }
}

export function hexToRgb(hex: string) {
    const result = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(hex);
    if (result) {
        const r = parseInt(result[1], 16);
        const g = parseInt(result[2], 16);
        const b = parseInt(result[3], 16);
        return [r, g, b]
    } 
    return [0, 0, 0];
}
