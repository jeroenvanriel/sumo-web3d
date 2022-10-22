import * as _ from 'lodash';
import * as dat from 'dat.gui/build/dat.gui.js';

export default class Config {
    private gui: typeof dat.gui.GUI;

    // TODO: load/save this to/from file
    private config : Record<string, Record<string, any>>  = {
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
        }
    }

    public controllers : { [category: string] :
            { [key: string] : typeof dat.gui.Controller } };

    constructor() {
        this.gui = new dat.gui.GUI();

        for (const category in this.config) {
            const folder = this.gui.addFolder(category);

            const cat = this.config[category];
            _.forEach(cat, (entry, key) => {
                let controller = null;
                if (_.has(entry, 'value')) {
                    controller = folder.add(entry, 'value', entry.min, entry.max);
                } else if (_.has(entry, 'color')) {
                    controller = folder.addColor(entry, 'color');
                }
                controller.name(key);
                if (controller) {
                    ((this.controllers ??= {})[category] ??= {})[key] = controller;
                }
            })
        }
    }

    private hexToRgb(hex: string) {
        const result = /^#?([a-fd]{2})([a-fd]{2})([a-fd]{2})$/i.exec(hex);
        if (result) {
            const r = parseInt(result[1], 16);
            const g = parseInt(result[2], 16);
            const b = parseInt(result[3], 16);
            return [r, g, b]
        } 
        return [0, 0, 0];
    }

    get(category: string, entry: string) {
        const c = this.config[category][entry];
        if (_.has(c, 'value')) { return c.value }
        else if (_.has(c, 'color')) {
            let cols: number[] = [0, 0, 0];
            if (typeof c.color == 'string') {
                cols = this.hexToRgb(c.color);
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
