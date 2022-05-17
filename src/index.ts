import { extendConfig, subtask, task, types } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import fs from "fs";
import { exec, ExecException } from "child_process";
import path from "path"
import { createHash } from "crypto";
import { HardhatConfig, HardhatUserConfig } from "hardhat/types";

import "./type-extensions";

export const TASK_STARKNET_COMPILE: string = "starknet-compile";
export const TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES: string = "starknet-compile:gather-cairo-files";
export const TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE: string = "starknet-compile:get-files-to-compile";
export const TASK_STARKNET_COMPILE_COMPILE: string = "starknet-compile:compile";

interface CairoFileCache {
    dependencies: {
        [filePath: string]: {
            lastModificationTime: number;
            hash: string;
        }
    }
}

interface CairoFilesCache {
    [filePath: string]: CairoFileCache;
}

// set up all the stuff that we add to the config
extendConfig((config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
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
    let cairoPath: string[] = [];

    const userCairoPath = userConfig.paths?.cairoPath;
    if (userCairoPath !== undefined) {
        cairoPath = userCairoPath;
    }

    config.paths.cairoPath = cairoPath;
});

// hook into normal compile task
task(TASK_COMPILE)
    .setAction(async (args, hre, runSuper) => {
        await runSuper();

        await hre.run(TASK_STARKNET_COMPILE);
    });

// standalone compile task
task(TASK_STARKNET_COMPILE)
    .setAction(async (args, hre) => {
        const cairoFiles: string[] = await hre.run(TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES);

        const cacheFilePath = `${hre.config.paths.cache}/cairo-files-cache.json`;
        const cairoFilesCache: CairoFilesCache = fs.existsSync(cacheFilePath) ?
            JSON.parse(fs.readFileSync(cacheFilePath).toString()) : {};

        const compileJobs: CompileJob[] = await hre.run(
            TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE,
            { sources: cairoFiles, cache: cairoFilesCache });

        if (compileJobs.length > 0) {
            try {
                await hre.run(TASK_STARKNET_COMPILE_COMPILE,
                    { compileJobs: compileJobs, cache: cairoFilesCache });
            }
            finally {
                if (!fs.existsSync(hre.config.paths.cache)) {
                    fs.mkdirSync(hre.config.paths.cache);
                }
                fs.writeFileSync("./cache/cairo-files-cache.json",
                    JSON.stringify(cairoFilesCache, null, 4));
            }
        }
        else {
            console.log("No Cairo files to compile");
        }
    });

// first gather files
subtask(TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES)
    .setAction(async (args, hre) => {
        if (!fs.existsSync(hre.config.paths.starknetSources)) {
            return [];
        }

        const findCairoFilesInDir = (dir: string): string[] => {
            let cairoFiles: string[] = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const entryPath = `${dir}/${entry.name}`;
                if (entry.isDirectory()) {
                    cairoFiles = cairoFiles.concat(findCairoFilesInDir(entryPath));
                }
                else if (entry.name.endsWith(".cairo")) {
                    cairoFiles.push(path.relative(hre.config.paths.starknetSources, entryPath));
                }
            }

            return cairoFiles;
        };

        // need these paths to be relative not absolute
        const cairoFiles = findCairoFilesInDir(hre.config.paths.starknetSources);

        return cairoFiles;
    });

type CompileJob = {
    source: string;
    artifactPath: string;
    abiPath: string;
}

// see what has changed
subtask(TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE)
    .addParam("sources", undefined, undefined, types.any)
    .addParam("cache", undefined, undefined, types.any)
    .setAction(async (args: { sources: string[], cache: CairoFilesCache }, hre): Promise<CompileJob[]> => {
        let toCompile: CompileJob[] = [];

        for (let i = 0; i < args.sources.length; ++i) {
            const source = args.sources[i];
            const sourceNoExt = path.basename(source.substring(0, source.length - 6));

            // we make a dir per cairo file, because we'll be making file.json
            // and file_abi.json, so if someone called their cairo file
            // thing_abi.cairo and another called thing.cairo then it would
            // cause issues.
            const artifactContainerDir = `${hre.config.paths.starknetArtifacts}/${source}`;

            const compileJob = {
                source: `${hre.config.paths.starknetSources}/${source}`,
                artifactPath: `${artifactContainerDir}/${sourceNoExt}.json`,
                abiPath: `${artifactContainerDir}/${sourceNoExt}_abi.json`
            }

            if (!fs.existsSync(compileJob.artifactPath) || !fs.existsSync(compileJob.abiPath)) {
                // artifact/abi doesn't exist so definitely needs compiling
                toCompile.push(compileJob);
                continue;
            }

            const fileCache = args.cache[compileJob.source];
            if (fileCache === undefined) {
                // not even in cache so definitely needs compiling
                toCompile.push(compileJob);
                continue;
            }

            // see if the file or any deps have changed
            for (const dependencyPath in fileCache.dependencies) {
                const dependency = fileCache.dependencies[dependencyPath];

                // first check file modified time
                if (fs.statSync(dependencyPath).mtime.getTime() != dependency.lastModificationTime) {
                    // modified time has changed, so now check contents have actually changed
                    const hash = createHash("md5").update(fs.readFileSync(dependencyPath)).digest().toString("hex");
                    if (hash != dependency.hash) {
                        toCompile.push(compileJob);
                    }
                }
            }
        }

        return toCompile;
    });

// compile files
subtask(TASK_STARKNET_COMPILE_COMPILE)
    .addParam("compileJobs", undefined, undefined, types.any)
    .addParam("cache", undefined, undefined, types.any)
    .setAction(async (args: { compileJobs: CompileJob[], cache: CairoFilesCache }, hre) => {
        // first make sure starknet-compile exists
        try {
            const compiler = await new Promise((resolve, reject) => {
                exec("which starknet-compile", (error, stdout) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve(stdout);
                    }
                });
            });
            if (compiler == "") {
                throw new HardhatPluginError("hardhat-starknet-compile", "Starknet compiler not found, did you forget to activate your venv?");
            }
        }
        catch (err) {
            throw new HardhatPluginError("hardhat-starknet-compile", "Starknet compiler not found, did you forget to activate your venv?");
        }

        // now attempt to compile everything and update the cache when successful
        const cache = args.cache;
        let promises = [];
        let promiseErrors: ExecException[] = [];

        let cairoPath = hre.config.paths.starknetSources;
        if (hre.config.paths.cairoPath.length > 0) {
            cairoPath += ":" + hre.config.paths.cairoPath.join(":");
        }

        // loop over sources and create a promise for each so they hopefully will run concurrently
        for (const compileJob of args.compileJobs) {
            const depsFile = `${compileJob.artifactPath}.deps.txt`;
            const outDir = path.dirname(compileJob.artifactPath);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }

            promises.push(new Promise<string>(async (resolve, reject) => {
                exec(`starknet-compile "${compileJob.source}" --output "${compileJob.artifactPath}" --abi "${compileJob.abiPath}" --cairo_dependencies "${depsFile}" --cairo_path "${cairoPath}"`,
                    (error, stdout) => {
                        if (error) {
                            // the artifacts can still be created even when compilation fails
                            if (fs.existsSync(compileJob.artifactPath)) {
                                fs.rmSync(compileJob.artifactPath);
                            }
                            if (fs.existsSync(compileJob.abiPath)) {
                                fs.rmSync(compileJob.abiPath);
                            }
                            if (fs.existsSync(depsFile)) {
                                fs.rmSync(depsFile);
                            }

                            reject(error);
                        }
                        else {
                            const fileCache: CairoFileCache = { dependencies: {} };

                            const depsRows = fs.readFileSync(depsFile).toString().split("\n");
                            fs.rmSync(depsFile);

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

                                const stats = fs.statSync(depsRow);
                                const hash = createHash("md5").update(fs.readFileSync(depsRow)).digest().toString("hex");
                                fileCache.dependencies[depsRow] = {
                                    lastModificationTime: stats.mtime.getTime(),
                                    hash: hash
                                }

                                cache[compileJob.source] = fileCache;
                            }

                            resolve(stdout);
                        }
                    });
            }).catch((err) => {
                promiseErrors.push(err);
            }));

        }

        // wait for everything to finish
        await Promise.all(promises);

        // Report successes
        const successfulCount = args.compileJobs.length - promiseErrors.length;
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

            throw new HardhatPluginError("hardhat-starknet-compile", "compilation of cairo contracts failed: \n" + errorString);
        }
    });