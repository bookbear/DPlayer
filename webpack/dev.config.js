const path = require('path');
const webpack = require('webpack');
const { GitRevisionPlugin } = require('git-revision-webpack-plugin');
const gitRevisionPlugin = new GitRevisionPlugin();
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');

/** @type {import('webpack').Configuration} */
module.exports = {

    // development build
    mode: 'development',

    // entry point
    entry: {
        DPlayer: './src/ts/index.ts',
    },

    // enable source map
    devtool: 'cheap-module-source-map',

    // output settings
    output: {
        path: path.resolve(__dirname, '..', 'dist'),
        filename: '[name].js',
        library: '[name]',
        libraryTarget: 'umd',
        libraryExport: 'default',
        umdNamedDefine: true,
        publicPath: '/',
    },

    // show error details
    stats: {
        errorDetails: true,
        children: true,
    },

    // mitigate maximum asset size
    performance: {
        maxAssetSize: 500000,
        maxEntrypointSize: 500000,
    },

    // webpack-dev-server settings
    devServer: {
        host: '0.0.0.0',
        compress: true,
        open: true,
        // localhost の HTTP でも COOP/COEP ヘッダーがあれば SharedArrayBuffer は使用可能
        historyApiFallback: {
            disableDotRule: true,
        },
        static: [
            {
                directory: path.resolve(__dirname, '..', 'demo'),
                watch: { ignored: /node_modules/ },
            },
            // @ffmpeg/ffmpeg ESM を same-origin で配信 (Worker の COEP 対応)
            {
                directory: path.resolve(__dirname, '..', 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm'),
                publicPath: '/ffmpeg',
                watch: false,
            },
            {
                directory: path.resolve(__dirname, '..', 'node_modules', '@ffmpeg', 'util', 'dist', 'esm'),
                publicPath: '/ffmpeg-util',
                watch: false,
            },
        ],
        // ffmpeg.wasm (SharedArrayBuffer) に必要な COOP/COEP ヘッダー
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
        },
    },

    // resolve modules
    resolve: {
        extensions: ['.ts', '.js', '.scss'],
    },

    // loader settings
    module: {
        strictExportPresence: true,
        rules: [
            {
                // compile TypeScript to JavaScript
                test: /\.ts$/,
                use: [
                    {
                        loader: 'ts-loader',
                    },
                ],
            },
            {
                // load source map
                test: /\.js$/,
                use: [
                    {
                        loader: 'source-map-loader',
                    },
                ],
            },
            {
                // compile JavaScript in Babel
                test: /\.js$/,
                use: [
                    {
                        loader: 'babel-loader',
                        options: {
                            cacheDirectory: true,
                            presets: ['@babel/preset-env'],
                        },
                    },
                ],
            },
            {
                test: /\.scss$/,
                use: [
                    // inject CSS into the DOM
                    'style-loader',
                    // load CSS
                    {
                        loader: 'css-loader',
                        options: {
                            importLoaders: 1,
                        },
                    },
                    // enable Autoprefixer and cssnano
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: [autoprefixer, cssnano],
                            },
                        },
                    },
                    // compile SASS (SCSS) to CSS
                    'sass-loader',
                ],
            },
            {
                // bundle images inline
                test: /\.(png|jpg)$/,
                type: 'asset/inline',
            },
            {
                // bundle svg icons (with html)
                test: /\.svg$/,
                loader: 'svg-inline-loader',
            },
            {
                // ART template to JavaScript
                test: /\.art$/,
                loader: 'art-template-loader',
            },
        ],
    },

    // define DPlayer version and Git hash
    plugins: [
        new webpack.DefinePlugin({
            DPLAYER_VERSION: `"${require('../package.json').version}"`,
            GIT_HASH: JSON.stringify(gitRevisionPlugin.version()),
        }),
        // art-template-loader が Windows 上でバックスラッシュのパスを生成するため
        // webpack がモジュール名として誤解釈する問題を修正
        new webpack.NormalModuleReplacementPlugin(
            /[/\\]art-template[/\\]lib[/\\]runtime/,
            require.resolve('art-template/lib/runtime'),
        ),
    ],
};
