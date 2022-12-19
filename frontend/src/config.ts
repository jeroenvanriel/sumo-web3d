import * as _ from 'lodash';
import { GUI, Controller } from 'lil-gui';

import { ModelParams, SupportedVehicle } from './initialization';

type GuiConfig = Record<string, Record<string, any>> ;

export interface Config {
    vehicles: { [sumoVehicleType: string]: SupportedVehicle };
    models: { [modelName: string]: ModelParams };
    guiConfig: GuiConfig;
}

export class ConfigManager {
    private gui: GUI;

    public config: Config;

    public controllers : { [category: string] :
            { [key: string] : Controller } };

    constructor() {
        this.listen = this.listen.bind(this)
        this.loadFromFile = this.loadFromFile.bind(this)

        this.gui = new GUI();
        this.gui.add(this, 'saveToFile').name('save');
    }

    async loadFromFile() {
        const data = await fetch('/config');
        this.config = await data.json();

        for (const category in this.config.guiConfig) {
            const folder = this.gui.addFolder(category);
            const cat = this.config.guiConfig[category];

            _.forEach(cat, (entry, key) => {
                let controller = null;
                if (_.has(entry, 'value')) {
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

    async saveToFile() {
        const options = {
            method: 'POST',
            body: JSON.stringify(this.config),
            headers: { 'Content-Type': 'applications/json' }
        }
        fetch('/config', options)
    }

    get(category: string, entry: string) {
        const c = this.config.guiConfig[category][entry];
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
            // listen to all controllers in this folder
            _.forEach(this.controllers[category], (controller, key) => {
                controller.onChange(listener);
                listener(controller.getValue());
            });
        } else {
            // listen to a single controller
            const controller = this.controllers[category][entry];
            controller.onChange(listener);
            listener(controller.getValue());
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
