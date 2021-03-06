// This file is part of cbuild, copyright (c) 2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

declare module 'systemjs-builder' {
	import * as Promise from 'bluebird';

	namespace Builder {
		/** systemjs-builder diagnostics for a single input file. */

		interface BuildItem {
			name: string;
			path: string;
			metadata: { [key: string]: any };
			/** List of imports. */
			deps: string[];
			/** Table mapping imports to their paths inside the bundle. */
			depMap: { [name: string]: string };
			source: string;
			fresh: boolean;
			timestamp: number;
			configHash: string;
			runtimePlugin: boolean;
			pluginConfig: any;
			packageConfig: any;
			isPackageConfig: any;
			deferredImports: any;
		}

		/** systemjs-builder diagnostics for the entire bundle. */

		interface BuildResult {
			/** Bundled output file contents. */
			source: string;
			sourceMap: string;
			/** List of bundled files. */
			modules: string[];
			/** List of files intended to be imported from the bundle(?). */
			entryPoints: string[];
			tree: { [path: string]: BuildItem };
			/** Other non-JavaScript files included in the bundle. */
			assetList: any;
			bundleName: string;
		}
	}

	class Loader {
		normalize(name: string, parentName: string, parentAddress: string): Promise<string>;

		map: { [name: string]: string };
	}

	class Builder {
		constructor(basePath: string, configPath: string);

		loadConfig(configPath: string): Promise<void>;

		bundle(
			sourcePath: string,
			targetPath: string,
			options: {}
		): Promise<Builder.BuildResult>;

		bundle(
			sourcePath: string,
			options: {}
		): Promise<Builder.BuildResult>;

		buildStatic(
			sourcePath: string,
			targetPath: string,
			options: {}
		): Promise<Builder.BuildResult>;

		buildStatic(
			sourcePath: string,
			options: {}
		): Promise<Builder.BuildResult>;

		loader: Loader;
	}

	export = Builder;
}

declare module 'browser-resolve' {
	const resolve: (name: string, options: {
		filename: string
	}) => string;

	export = resolve;
}
