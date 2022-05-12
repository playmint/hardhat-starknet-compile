"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_STARKNET_COMPILE_COMPILE = exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE = exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES = exports.TASK_STARKNET_COMPILE = void 0;
const config_1 = require("hardhat/config");
const plugins_1 = require("hardhat/plugins");
const task_names_1 = require("hardhat/builtin-tasks/task-names");
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
require("./type-extensions");
exports.TASK_STARKNET_COMPILE = "starknet-compile";
exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES = "starknet-compile:gather-cairo-files";
exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE = "starknet-compile:get-files-to-compile";
exports.TASK_STARKNET_COMPILE_COMPILE = "starknet-compile:compile";
// set up all the stuff that we add to the config
(0, config_1.extendConfig)((config, userConfig) => {
    // sources dir - where the cairo files will be
    let starknetSources = config.paths.sources; // by default just use the regular sources dir
    const userStarknetSources = userConfig.paths?.starknetSources;
    if (userStarknetSources !== undefined) {
        starknetSources = userStarknetSources;
    }
    config.paths.starknetSources = starknetSources;
    // artifacts dir - where build output goes
    let starknetArtifacts = "artifacts-starknet";
    const userStarknetArtifacts = userConfig.paths?.starknetArtifacts;
    if (userStarknetArtifacts !== undefined) {
        starknetArtifacts = userStarknetArtifacts;
    }
    config.paths.starknetArtifacts = starknetArtifacts;
    // cairo path - passed to compiler --cairo_path arg
    let cairoPath = [];
    const userCairoPath = userConfig.paths?.cairoPath;
    if (userCairoPath !== undefined) {
        cairoPath = userCairoPath;
    }
    config.paths.cairoPath = cairoPath;
});
// hook into normal compile task
(0, config_1.task)(task_names_1.TASK_COMPILE)
    .setAction(async (args, hre, runSuper) => {
    await runSuper();
    await hre.run(exports.TASK_STARKNET_COMPILE);
});
// standalone compile task
(0, config_1.task)(exports.TASK_STARKNET_COMPILE)
    .setAction(async (args, hre) => {
    const cairoFiles = await hre.run(exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES);
    const cacheFilePath = `${hre.config.paths.cache}/cairo-files-cache.json`;
    const cairoFilesCache = fs_1.default.existsSync(cacheFilePath) ?
        JSON.parse(fs_1.default.readFileSync(cacheFilePath).toString()) : {};
    const toCompile = await hre.run(exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE, { sources: cairoFiles, cache: cairoFilesCache });
    if (toCompile.length > 0) {
        try {
            await hre.run(exports.TASK_STARKNET_COMPILE_COMPILE, { sources: toCompile, cache: cairoFilesCache });
        }
        finally {
            fs_1.default.writeFileSync("./cache/cairo-files-cache.json", JSON.stringify(cairoFilesCache, null, 4));
        }
    }
    else {
        console.log("No Cairo files to compile");
    }
});
// first gather files
(0, config_1.subtask)(exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES)
    .setAction(async (args, hre) => {
    const findCairoFilesInDir = (dir) => {
        let cairoFiles = [];
        const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                cairoFiles = cairoFiles.concat(findCairoFilesInDir(entryPath));
            }
            else if (entry.name.endsWith(".cairo")) {
                cairoFiles.push(entryPath);
            }
        }
        return cairoFiles;
    };
    // need these paths to be relative not absolute
    const starknetSources = path_1.default.relative(hre.config.paths.root, hre.config.paths.starknetSources);
    const cairoFiles = findCairoFilesInDir(starknetSources);
    return cairoFiles;
});
// see what has changed
(0, config_1.subtask)(exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE)
    .addParam("sources", undefined, undefined, config_1.types.any)
    .addParam("cache", undefined, undefined, config_1.types.any)
    .setAction(async (args, hre) => {
    let toCompile = [];
    for (let i = 0; i < args.sources.length; ++i) {
        const source = args.sources[i];
        if (!fs_1.default.existsSync(`${hre.config.paths.starknetArtifacts}/${source.substring(0, source.length - 6)}.json`)) {
            // artifact doesn't exist so definitely needs compiling
            toCompile.push(source);
            continue;
        }
        const fileCache = args.cache[source];
        if (fileCache === undefined) {
            // not even in cache so definitely needs compiling
            toCompile.push(source);
            continue;
        }
        // see if the file or any deps have changed
        for (const dependencyPath in fileCache.dependencies) {
            const dependency = fileCache.dependencies[dependencyPath];
            // first check file modified time
            if (fs_1.default.statSync(dependencyPath).mtime.getTime() != dependency.lastModificationTime) {
                // modified time has changed, so now check contents have actually changed
                const hash = (0, crypto_1.createHash)("md5").update(fs_1.default.readFileSync(dependencyPath)).digest().toString("hex");
                if (hash != dependency.hash) {
                    toCompile.push(source);
                }
            }
        }
    }
    return toCompile;
});
// compile files
// TODO concurrency
(0, config_1.subtask)(exports.TASK_STARKNET_COMPILE_COMPILE)
    .addParam("sources", undefined, undefined, config_1.types.any)
    .addParam("cache", undefined, undefined, config_1.types.any)
    .setAction(async (args, hre) => {
    // first make sure starknet-compile exists
    try {
        const compiler = await new Promise((resolve, reject) => {
            (0, child_process_1.exec)("which starknet-compile", (error, stdout) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(stdout);
                }
            });
        });
        if (compiler == "") {
            throw new plugins_1.HardhatPluginError("hardhat-starknet-compile", "Starknet compiler not found, did you forget to activate your venv?");
        }
    }
    catch (err) {
        throw new plugins_1.HardhatPluginError("hardhat-starknet-compile", "Starknet compiler not found, did you forget to activate your venv?");
    }
    // now attempt to compile everything and update the cache when successful
    const cache = args.cache;
    let promises = [];
    let promiseErrors = [];
    let cairoPath = hre.config.paths.starknetSources;
    if (hre.config.paths.cairoPath.length > 0) {
        cairoPath += ":" + hre.config.paths.cairoPath.join(":");
    }
    // loop over sources and create a promise for each so they hopefully will run concurrently
    for (const source of args.sources) {
        const depsFile = `${hre.config.paths.starknetArtifacts}/${source}.deps.txt`;
        const outFile = `${hre.config.paths.starknetArtifacts}/${source.substring(0, source.length - 6)}.json`;
        const outDir = path_1.default.dirname(outFile);
        if (!fs_1.default.existsSync(outDir)) {
            fs_1.default.mkdirSync(outDir, { recursive: true });
        }
        promises.push(new Promise(async (resolve, reject) => {
            (0, child_process_1.exec)(`starknet-compile "${source}" --output "${outFile}" --cairo_dependencies "${depsFile}" --cairo_path "${cairoPath}"`, (error, stdout) => {
                if (error) {
                    // the artifacts can still be created even when compilation fails
                    if (fs_1.default.existsSync(outFile)) {
                        fs_1.default.rmSync(outFile);
                    }
                    if (fs_1.default.existsSync(depsFile)) {
                        fs_1.default.rmSync(depsFile);
                    }
                    reject(error);
                }
                else {
                    const fileCache = { dependencies: {} };
                    const depsRows = fs_1.default.readFileSync(depsFile).toString().split("\n");
                    fs_1.default.rmSync(depsFile);
                    // note, these deps include the current file, which is why we don't 
                    // explicitly hash it
                    for (let i = 0; i < depsRows.length; ++i) {
                        const depsRow = depsRows[i].trim();
                        // ignore any empty row
                        // ignore the SET (DEPENDENCIES line at the start, and the closing )
                        if (depsRow.length == 0 ||
                            ["SET (DEPENDENCIES", ")"].indexOf(depsRow) != -1) {
                            continue;
                        }
                        const stats = fs_1.default.statSync(depsRow);
                        const hash = (0, crypto_1.createHash)("md5").update(fs_1.default.readFileSync(depsRow)).digest().toString("hex");
                        fileCache.dependencies[depsRow] = {
                            lastModificationTime: stats.mtime.getTime(),
                            hash: hash
                        };
                        cache[source] = fileCache;
                    }
                    resolve(stdout);
                }
            });
        }).catch((err) => {
            promiseErrors.push(err);
        }));
    }
    // wait for everything to finish, I didn't use
    // Promise.all because that always seemed to 
    // kill all the promises if one failed. I'd like
    // as many to succeed as possible.
    for (const p of promises) {
        await p;
    }
    // Report successes
    const successfulCount = args.sources.length - promiseErrors.length;
    if (successfulCount > 0) {
        console.log(`Compiled ${successfulCount} Cairo ${successfulCount > 1 ? "files" : "file"} successfully`);
    }
    // Report errors
    if (promiseErrors.length > 0) {
        console.log(`${promiseErrors.length} ${promiseErrors.length > 1 ? "errors" : "error"}`);
        let errorString = "";
        for (const err of promiseErrors) {
            // remove the "command failed etc" line, we already know that
            let msgRows = err.message.split("\n");
            if (msgRows[0].startsWith("Command failed: starknet-compile ")) {
                msgRows = msgRows.slice(1);
            }
            // the rest of the lines should give the user the file and line number etc
            errorString += msgRows.join("\n") + "\n";
        }
        throw new plugins_1.HardhatPluginError("hardhat-starknet-compile", "compilation of cairo contracts failed: \n" + errorString);
    }
});
//# sourceMappingURL=index.js.map