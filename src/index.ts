import { extendConfig, subtask, task, types } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import fs from "fs";
import { exec, ExecException } from "child_process";
import path from "path"
import { createHash } from "crypto";
import { HardhatConfig, HardhatUserConfig } from "hardhat/types";

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
        starknetSources = userStarknetSources!;
    }

    config.paths.starknetSources = starknetSources;

    // artifacts dir - where build output goes
    let starknetArtifacts = "artifacts-starknet";

    const userStarknetArtifacts = userConfig.paths?.starknetArtifacts;
    if (userStarknetArtifacts !== undefined) {
        starknetArtifacts = userStarknetArtifacts!;
    }

    config.paths.starknetArtifacts = starknetArtifacts;
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

        const toCompile: string[] = await hre.run(
            TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE,
            { sources: cairoFiles, cache: cairoFilesCache });

        if (toCompile.length > 0) {
            try {
                await hre.run(TASK_STARKNET_COMPILE_COMPILE,
                    { sources: toCompile, cache: cairoFilesCache });
            }
            finally {
                fs.writeFileSync("./cache/cairo-files-cache.json",
                    JSON.stringify(cairoFilesCache, null, 4));
            }

            console.log(`Compiled ${toCompile.length} Cairo ${toCompile.length > 1 ? "files" : "file"} successfully`);
        }
        else {
            console.log("No Cairo files to compile");
        }
    });

// first gather files
subtask(TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES)
    .setAction(async (args, hre) => {
        const findCairoFilesInDir = (dir: string): string[] => {
            let cairoFiles: string[] = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const path = `${dir}/${entry.name}`;
                if (entry.isDirectory()) {
                    cairoFiles = cairoFiles.concat(findCairoFilesInDir(path));
                }
                else if (entry.name.endsWith(".cairo")) {
                    cairoFiles.push(path);
                }
            }

            return cairoFiles;
        };

        const cairoFiles = findCairoFilesInDir(hre.config.paths.starknetSources);

        return cairoFiles;
    });

// see what has changed
subtask(TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE)
    .addParam("sources", undefined, undefined, types.any)
    .addParam("cache", undefined, undefined, types.any)
    .setAction(async (args: { sources: string[], cache: CairoFilesCache }): Promise<string[]> => {
        let toCompile: string[] = [];

        for (let i = 0; i < args.sources.length; ++i) {
            const fileCache = args.cache[args.sources[i]];
            if (fileCache === undefined) {
                // not even in cache so definitely needs compiling
                toCompile.push(args.sources[i]);
            }
            else {
                for (const dependencyPath in fileCache.dependencies) {
                    const dependency = fileCache.dependencies[dependencyPath];

                    // first check file modified time
                    if (fs.statSync(dependencyPath).mtime.getTime() != dependency.lastModificationTime) {
                        // modified time has changed, so now check contents have actually changed
                        const hash = createHash("md5").update(fs.readFileSync(dependencyPath)).digest().toString("hex");
                        if (hash != dependency.hash) {
                            toCompile.push(args.sources[i]);
                        }
                    }
                }
            }
        }

        return toCompile;
    });

// compile files
// TODO concurrency
subtask(TASK_STARKNET_COMPILE_COMPILE)
    .addParam("sources", undefined, undefined, types.any)
    .addParam("cache", undefined, undefined, types.any)
    .setAction(async (args: { sources: string[], cache: CairoFilesCache }, hre) => {
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

        const cache = args.cache;

        for (const source of args.sources) {
            const outFile = `${hre.config.paths.artifacts}/${source.substring(0, source.length - 6)}.json`;
            const outDir = path.dirname(outFile);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }

            try {
                await new Promise((resolve, reject) => {
                    exec(`starknet-compile "${source}" --output "${outFile}" --cairo_dependencies deps.txt`,
                        (error, stdout) => {
                            if (error) {
                                reject(error);
                            }
                            else {
                                resolve(stdout);
                            }
                        });
                });
            }
            catch (error) {
                const exc = (error as ExecException);

                // remove the "command failed etc" line, we already know that
                let msgRows = exc.message.split("\n");
                if (msgRows[0].startsWith("Command failed: starknet-compile ")) {
                    msgRows = msgRows.slice(1);
                }
                throw new HardhatPluginError("hardhat-starknet-compile", "compilation of cairo contracts failed: \n" + msgRows.join("\n"));
            }

            const fileCache: CairoFileCache = { dependencies: {} };
            const depsRows = fs.readFileSync("deps.txt").toString().split("\n");
            fs.rmSync("deps.txt");

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
            }

            cache[source] = fileCache;
        }
    });