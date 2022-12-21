# Build instructions

## Backend
The backend is build using [PyInstaller](https://pyinstaller.org).
It uses an application specification file `sumo_web3d.spec` to locate the Python code and the main entry point `backend/sumo_web3d.py`.
I had to set the `hiddenimports` setting, but I do not recall why.
During building, PyInstaller writes some log files and working files to `build/`.
The output of the backend build process is an executable `sumo_web3d` for Linux or `sumo_web3d.exe` for Windows.
Note that building for Windows is only possible on a Windows system.
The GitHub [workflow](https://github.com/jeroenvanriel/sumo-web3d/actions/workflows/main.yml), configured [here](https://github.com/jeroenvanriel/sumo-web3d/blob/master/.github/workflows/main.yml), build for both platforms automatically and provides both executables for download.

## Frontend
The frontend Javascript/Typescript code is build using [Webpack](webpack.js.org), which is configured to output a single `index.bundle.js` file in the `backend/static/` folder.
This is also the location where the backend executable expects to find this bundle in order to serve it to a requesting client.

It would be nice if frontend building is also automated in a GitHub workflow.

## Folder structure
Apart from the frontend bundle, the (backend) executable also expects to find assets and configuration files in specific folder.
The folder structure is roughly as follows:

```
dist
├── scenarios
│   ├── simple-crossing
│   │   ├── fcd.xml
│   │   ├── simple.net.xml
│   │   ├── simple.sumocfg
│   └── scenarios.json
├── static
│   ├── ... various static assets ...
│   ├── index.bundle.js
│   ├── index.html
│   ├── index.css
│   └── config.json
└── sumo_web3d
```

I have kept the original and experimental (OSM import, Mathematica generated FCD, lane gradient: grid, grid2, grid3) scenario files under `dist/` in my local repository.
