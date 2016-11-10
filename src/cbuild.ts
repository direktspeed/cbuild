// This file is part of cbuild, copyright (c) 2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as path from 'path';
import * as Promise from 'bluebird';
import * as Builder from 'systemjs-builder';
import * as resolve from 'browser-resolve';
export {BuildResult, BuildItem} from 'systemjs-builder';

/** Options object for the build function. */

export interface BuildOptions {
	/** If true, set NODE_ENV to development. */
	debug?: boolean;

	/** If true, create static (sfx) bundle. */
	sfx?: boolean;

	/** Bundled file to output. */
	bundlePath?: string;

	/** Main source file to bundle. */
	sourcePath?: string;

	/** Output config mapping other package names to their main source files. */
	outConfigPath?: string;

	/** Merge other config files into output config. */
	includeConfigList?: string[];

	/** Map additional packages in output config. */
	mapPackages?: string[];
}

function writeConfig(
	options: BuildOptions,
	pathTbl: { [name: string]: string },
	fixTbl: { [path: string]: string },
	repoList: string[],
	shimPath: string
) {
	const sectionList: string[] = [];
	const fixList = Object.keys(fixTbl);

	// Output table mapping npm package names to their main entry points.

	sectionList.push(
		'\tmap: {\n' +
		Object.keys(pathTbl).map((name: string) =>
			'\t\t"' + name + '": "' + pathTbl[name] + '"'
		).join(',\n') + '\n' +
		'\t}'
	);

	// Output meta command to inject a global process variable to all files
	// under all encountered node_modules trees.

	sectionList.push(
		'\tmeta: {\n' +
		repoList.map((path: string) =>
			'\t\t"' + path + '/*": { globals: { process: "' + shimPath + '" } }'
		).join(',\n') + '\n' +
		'\t}'
	);

	// Output a list of fixes to file paths, mainly to append index.js
	// where a directory is being imported.

	if(fixList.length) {
		sectionList.push(
			'\tpackages: {\n' +
			'\t\t".": {\n' +
			'\t\t\tmap: {\n' +
			fixList.map((path: string) =>
				'\t\t\t\t"' + path + '": "' + fixTbl[path] + '"'
			).join(',\n') + '\n' +
			'\t\t\t}\n' +
			'\t\t}\n' +
			'\t}'
		);
	}

	const output = options.includeConfigList.map((path: string) =>
		fs.readFileSync(path, { encoding: 'utf-8' })
	).join('\n') + (
		'System.config({\n' +
		sectionList.join(',\n') + '\n' +
		'});\n'
	);

	return(fs.writeFileSync(options.outConfigPath, output, { encoding: 'utf-8' }));
}

function url2path(urlPath: string) {
	let nativePath = urlPath.replace(/^file:\/\//, '');

	if(path.sep != '/') {
		if(nativePath.match(/^\/[0-9A-Za-z]+:\//)) nativePath = nativePath.substr(1);
		nativePath = nativePath.replace(/\//g, path.sep);
	}

	return(nativePath);
}

function path2url(nativePath: string) {
	let urlPath = nativePath;

	if(path.sep != '/') {
		const re = new RegExp(path.sep.replace(/\\/g, '\\\\'), 'g');

		urlPath = urlPath.replace(re, '/');
		if(urlPath.match(/^[0-9A-Za-z]+:\//)) urlPath = '/' + urlPath;
	}

	return(urlPath.replace(/^\//, 'file:///'));
}

const resolveAsync = Promise.promisify(resolve);

/** Bundle files from package in basePath according to options. */

export function build(basePath: string, options?: BuildOptions) {
	const builder = new Builder(path2url(basePath), 'config.js');
	const pathTbl: { [name: string]: string } = {};
	const fixTbl: { [path: string]: string } = {};
	const repoTbl: { [path: string]: boolean } = {};

	/** Find the main entry point to an npm package (considering package.json
	  * browser fields of the required and requiring packages). */

	function findPackage(name: string, parentName: string) {
		return(resolveAsync(name, { filename: url2path(parentName) }).then((pathName: string) => {
			if(pathName == name) throw(new Error('Internal module'));
			pathName = path2url(path.relative(basePath, pathName));

			// Store entry point path for this package name.
			pathTbl[name] = pathName;

			// Store path of top node_modules directory.
			repoTbl[pathName.replace(/((\/|^)node_modules)\/.*/i, '$1')] = true;

			return(pathName);
		}));
	}

	function newNormalize(
		name: string,
		parentName: string,
		parentAddress: string,
		pathName: string
	) {
		const indexName = pathName.replace(/.js$/, '/index.js');

		if(builder.loader.map) {
			const other = builder.loader.map[name];
			if(other && other != name) {
				return(builder.loader.normalize(other, parentName, parentAddress));
			}
		}

		return(
			Promise.promisify(fs.stat)(
				url2path(indexName)
			).then((stats: fs.Stats) => {
				const oldPath = './' + path.relative(basePath, url2path(pathName));
				const newPath = './' + path.relative(basePath, url2path(indexName));

				// TODO: test on Windows
				fixTbl[oldPath] = newPath;

				return(indexName);
			}).catch((err: NodeJS.ErrnoException) =>
				findPackage(name, parentName)
			).catch((err: any) =>
				pathName
			)
		);
	}

	options = options || {};

	const bundlePath = options.bundlePath;
	let sourcePath = options.sourcePath;

	// If no entry point for bundling was given, use the browser or main field
	// in package.json under the base directory.

	if(!sourcePath) {
		const packageJson = require(path.resolve(basePath, 'package.json'));
		const browser = packageJson.browser;

		sourcePath = path.resolve(
			basePath,
			typeof(browser) == 'string' ? browser : packageJson.main
		);
	}

	/** Old systemjs-builder normalize function which doesn't look for npm packages.
	  * See https://github.com/ModuleLoader/es6-module-loader/wiki/Extending-the-ES6-Loader */
	const oldNormalize = builder.loader.normalize;

	// Replace systemjs-builder normalize function adding support for
	// npm packages and gathering information about paths needed for
	// generating a SystemJS configuration file.

	builder.loader.normalize = function(
		name: string,
		parentName: string,
		parentAddress: string
	) {
		let pathName: string;

		return(
			// tslint:disable-next-line:no-invalid-this
			oldNormalize.call(this, name, parentName, parentAddress).then((result: string) => {
				pathName = result;
				return(Promise.promisify(fs.stat)(url2path(pathName)));
			}).then((stats: fs.Stats) =>
				pathName
			).catch((err: NodeJS.ErrnoException) =>
				newNormalize(name, parentName, parentAddress, pathName)
			)
		);
	};

	let built: Promise<Builder.BuildResult>;
	const sourceUrl = path2url(sourcePath);

	// Run systemjs-builder.

	let build = options.sfx ? builder.buildStatic : builder.bundle;

	const buildArguments = ([] as any[]).concat(
		[ sourceUrl ],
		(bundlePath ? [bundlePath] : []),
		[{}]
	);

	built = build.apply(builder, buildArguments);

	return(built.then(() =>

		// Add mappings to any extra packages listed in command line options.

		Promise.map(options.mapPackages || [], (name: string) =>
			findPackage(name, path.resolve(basePath, 'package.json'))
		)
	).then(() => {

		// Restore original systemjs-builder normalize function.

		builder.loader.normalize = oldNormalize;

		if(options.outConfigPath) {

			// Output SystemJS configuration file.

			return(
				resolveAsync(
					// TODO: test on Windows
					options.debug ? 'cbuild/process-dev.js' : 'cbuild/process.js',
					{ filename: path.resolve(basePath, 'package.json') }
				).then((shimPath: string) =>
					writeConfig(
						options,
						pathTbl,
						fixTbl,
						Object.keys(repoTbl),
						path.relative(basePath, shimPath)
					)
				)
			);
		}
	}).then(() => built.value()));
}

/** Dependency tree branch, used for makeTree() output. */

export interface Branch extends Array<string | Branch> {
	/** File name. */
	0?: string;
}

/** Extract a dependency tree from the build function result object.
  * Returns a nameless root item.
  * Each item is a list of a file name and its child items.
  * Uses Breadth-First Search to print shortest import chain to each file. */

export function makeTree(result: Builder.BuildResult) {
	const output: Branch = [''];
	const queue: string[] = [];
	const found: { [name: string]: Branch } = {};

	function report(name: string, branch: Branch) {
		if(!found[name]) {
			const leaf: Branch = [name];
			found[name] = leaf;

			branch.push(leaf);
			queue.push(name);
		}
	}

	let entryPoints = result.entryPoints;

	if(!entryPoints) {
		// Bundling reported no entry points (maybe it's an sfx bundle).
		// Create a table of all modules that were imported somehow.

		const importedTbl: { [name: string]: boolean } = {};

		for(let name of Object.keys(result.tree)) {
			const item = result.tree[name];

			for(let dep of item.deps) {
				importedTbl[item.depMap[dep]] = true;
			}
		}

		// Assume modules not imported by others are entry points.

		entryPoints = Object.keys(result.tree).filter((name: string) => !importedTbl[name]);
	}

	for(let name of entryPoints) report(name, output);

	while(queue.length) {
		const name = queue.shift();
		const branch = found[name];
		const item = result.tree[name];

		for(let dep of item.deps) report(item.depMap[dep], branch);
	}

	return(output);
}
