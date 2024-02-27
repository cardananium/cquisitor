const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/index.js',
  experiments: {
    asyncWebAssembly: true,
    syncWebAssembly: true,
    topLevelAwait: true
  },
  module: {
    rules: [
        {
          test: /\.(tsx|ts|js|mjs|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/preset-react']
            }
          },
          resolve: {
            fullySpecified: false
          }
        },
        {
            test: /\.css$/,
            use: ['style-loader', 'css-loader']
        }
      ]
  },
  resolve: {
    extensions: ['*', '.js', '.jsx', ".ts", ".tsx", ".mjs"],
    modules: ["node_modules"]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
};
