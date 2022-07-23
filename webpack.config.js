const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'development',
  entry: {
    index: __dirname + '/frontend/src/index.tsx',
  },
  output: {
    path: __dirname + '/backend/static',
    filename: '[name].bundle.js',
  },
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.js$/,
        enforce: "pre",
        loader: 'source-map-loader',
      },
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true,
        },
      },
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loader: 'babel',
        options: {
          presets: ['react', 'es2015'],
        },
      },
    ],
  },
  // Currently we need to add '.ts' to the resolve.extensions array.
  resolve: {
    extensions: ['', '.ts', '.tsx', '.webpack.js', '.web.js', '.js', '.jsx', '.json'],
    roots: [ path.resolve('./node_modules') ],
  },
  resolveLoader: {
    roots: [ path.resolve('./node_modules') ],
  },
}
