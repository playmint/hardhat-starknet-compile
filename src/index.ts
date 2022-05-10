import { subtask, task, types } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import fs from "fs";
import { exec, ExecException } from "child_process";
import path from "path"
import { createHash } from "crypto";

export const TASK_STARKNET_COMPILE: string = "starknet-compile";
export const TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES: string = "starknet-compile:gather-cairo-files";
export const TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE: string = "starknet-compile:get-files-to-compile";
export const TASK_STARKNET_COMPILE_COMPILE: string = "starknet-compile:compile";

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
        const toCompile: string[] = await hre.run(TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE, { sources: cairoFiles });
        await hre.run(TASK_STARKNET_COMPILE_COMPILE, { sources: toCompile });
    });

// first gather files
subtask(TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES)
    .setAction(async () => {
        // TODO configurable contract dirs
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

        const contractDirs = ["contracts"];
        let cairoFiles: string[] = [];
        for (const contractDir of contractDirs) {
            cairoFiles = cairoFiles.concat(findCairoFilesInDir(contractDir));
        }

        return cairoFiles;
    });

// TODO check there's a valid compiler

// see what has changed
subtask(TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE)
    .addParam("sources", undefined, undefined, types.any)
    .setAction(async (args: { sources: string[] }): Promise<string[]> => {
        return args.sources;
    });

// compile files
// TODO concurrency
subtask(TASK_STARKNET_COMPILE_COMPILE)
    .addParam("sources", undefined, undefined, types.any)
    .setAction(async (args: { sources: string[] }) => {
        // TODO configurable
        const artifactsDir = "artifacts-starknet";

        let cache: { [file: string]: any } = {}; // TODO need to pass this in from parent task so it can written to disk regardless of exceptions

        for (const source of args.sources) {
            // TODO configurable artifacts dir
            console.log(source);
            const outFile = `${artifactsDir}/${source.substring(0, source.length - 6)}.json`;
            const outDir = path.dirname(outFile);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }

            try {
                await new Promise((resolve, reject) => {
                    exec(`starknet-compile "${source}" --output "${outFile}" --cairo_dependencies deps.txt`, (error, stdout) => {
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

            let deps: { [file: string]: any } = {};
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

                const stats = fs.statSync(depsRows[i]);
                const hash = createHash("md5").update(fs.readFileSync(depsRows[i])).digest().toString("hex");
                deps[depsRows[i]] = {
                    lastModificationTime: stats.mtime.getTime(),
                    hash: hash
                }
            }

            cache[source] = {
                dependencies: deps
            };
        }

        // TODO is the cache dir folder configurable?
        fs.writeFileSync("./cache/cairo-files-cache.json", JSON.stringify(cache, null, 4));
    });